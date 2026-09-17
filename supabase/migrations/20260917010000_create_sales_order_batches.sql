-- =============================================================================
-- Migration: create_sales_order_batches
-- Internal dispatch tracking (not synced to Zoho). A sales order is dispatched in
-- batches; each batch records, per item, the box info and the quantity sent.
-- Remaining per item = total quantity sent − original (Zoho) quantity:
--   < 0 → still to send · 0 → complete · > 0 → over-sent
-- =============================================================================

-- Batches -----------------------------------------------------------------------
create table public.sales_order_batches (
  id                uuid primary key default gen_random_uuid(),
  sales_order_id    uuid not null references public.sales_orders (id) on delete cascade,
  batch_seq         integer not null,
  batch_number      text not null,            -- e.g. SO-00045-B1
  created_by        uuid references auth.users (id) on delete set null,
  created_by_email  text,
  updated_by        uuid references auth.users (id) on delete set null,
  updated_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (sales_order_id, batch_seq)
);

create index sales_order_batches_created_at_idx on public.sales_order_batches (created_at desc);

create trigger sales_order_batches_set_updated_at
  before update on public.sales_order_batches
  for each row execute function public.set_updated_at();

-- Batch items -------------------------------------------------------------------
create table public.sales_order_batch_items (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references public.sales_order_batches (id) on delete cascade,
  sales_order_id       uuid not null references public.sales_orders (id) on delete cascade,
  -- Set null if the line item is removed in Zoho; the snapshot below keeps the history readable.
  sales_order_item_id  uuid references public.sales_order_items (id) on delete set null,
  box_label            text not null check (btrim(box_label) <> '' and char_length(box_label) <= 200),
  quantity_sent        numeric not null check (quantity_sent > 0),

  -- Snapshot of the item when the batch was saved
  item_name            text not null,
  item_sku             text,
  original_quantity    numeric,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (batch_id, sales_order_item_id)
);

create index sales_order_batch_items_batch_id_idx on public.sales_order_batch_items (batch_id);
create index sales_order_batch_items_sales_order_id_idx on public.sales_order_batch_items (sales_order_id);
create index sales_order_batch_items_item_id_idx on public.sales_order_batch_items (sales_order_item_id);

create trigger sales_order_batch_items_set_updated_at
  before update on public.sales_order_batch_items
  for each row execute function public.set_updated_at();

-- Row Level Security: any signed-in user can manage batches ----------------------------
alter table public.sales_order_batches enable row level security;
alter table public.sales_order_batch_items enable row level security;

create policy "Authenticated users can view batches"
  on public.sales_order_batches for select to authenticated using (true);
create policy "Authenticated users can create batches"
  on public.sales_order_batches for insert to authenticated with check (true);
create policy "Authenticated users can update batches"
  on public.sales_order_batches for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete batches"
  on public.sales_order_batches for delete to authenticated using (true);

create policy "Authenticated users can view batch items"
  on public.sales_order_batch_items for select to authenticated using (true);
create policy "Authenticated users can create batch items"
  on public.sales_order_batch_items for insert to authenticated with check (true);
create policy "Authenticated users can update batch items"
  on public.sales_order_batch_items for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete batch items"
  on public.sales_order_batch_items for delete to authenticated using (true);

-- Per-item dispatch totals --------------------------------------------------------
create view public.sales_order_item_dispatch
with (security_invoker = true) as
select
  i.id                                                   as sales_order_item_id,
  i.sales_order_id,
  coalesce(i.quantity, 0)                                as original_quantity,
  coalesce(sum(bi.quantity_sent), 0)                     as quantity_sent,
  coalesce(sum(bi.quantity_sent), 0) - coalesce(i.quantity, 0) as remaining
from public.sales_order_items i
left join public.sales_order_batch_items bi on bi.sales_order_item_id = i.id
group by i.id;

-- Batch list with order info and totals ---------------------------------------------
create view public.sales_order_batch_summaries
with (security_invoker = true) as
select
  b.id,
  b.batch_number,
  b.batch_seq,
  b.sales_order_id,
  so.salesorder_number,
  so.customer_name,
  b.created_by_email,
  b.updated_by_email,
  b.created_at,
  b.updated_at,
  count(bi.id)::integer                   as item_count,
  coalesce(sum(bi.quantity_sent), 0)      as total_quantity,
  count(distinct bi.box_label)::integer   as box_count
from public.sales_order_batches b
join public.sales_orders so on so.id = b.sales_order_id
left join public.sales_order_batch_items bi on bi.batch_id = b.id
group by b.id, so.id;

-- Create or update a batch atomically ------------------------------------------------
-- p_items: [{ "sales_order_item_id": uuid, "box_label": text, "quantity_sent": number }]
-- p_batch_id null → new batch (next batch number for the order); otherwise replaces its items.
create or replace function public.save_sales_order_batch(
  p_sales_order_id uuid,
  p_items jsonb,
  p_batch_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id   uuid := auth.uid();
  v_email     text := auth.jwt() ->> 'email';
  v_batch_id  uuid := p_batch_id;
  v_so_number text;
  v_seq       integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Enter a sent quantity for at least one item.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(sales_order_item_id uuid, box_label text, quantity_sent numeric)
    where x.sales_order_item_id is null
       or x.quantity_sent is null
       or x.quantity_sent <= 0
       or nullif(btrim(x.box_label), '') is null
  ) then
    raise exception 'Every item being sent needs box info and a quantity greater than 0.';
  end if;

  if (select count(*) from jsonb_array_elements(p_items))
     <> (select count(distinct e ->> 'sales_order_item_id') from jsonb_array_elements(p_items) e) then
    raise exception 'An item appears more than once in the batch.';
  end if;

  select salesorder_number into v_so_number from public.sales_orders where id = p_sales_order_id;
  if v_so_number is null then
    raise exception 'Sales order not found.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(sales_order_item_id uuid)
    left join public.sales_order_items i
      on i.id = x.sales_order_item_id and i.sales_order_id = p_sales_order_id
    where i.id is null
  ) then
    raise exception 'One or more items do not belong to this sales order.';
  end if;

  if v_batch_id is null then
    -- Serialise batch numbering per order.
    perform pg_advisory_xact_lock(hashtext('sales_order_batch:' || p_sales_order_id::text));

    select coalesce(max(batch_seq), 0) + 1 into v_seq
    from public.sales_order_batches
    where sales_order_id = p_sales_order_id;

    insert into public.sales_order_batches (sales_order_id, batch_seq, batch_number, created_by, created_by_email)
    values (p_sales_order_id, v_seq, v_so_number || '-B' || v_seq, v_user_id, v_email)
    returning id into v_batch_id;
  else
    update public.sales_order_batches
    set updated_by = v_user_id, updated_by_email = v_email
    where id = v_batch_id and sales_order_id = p_sales_order_id;

    if not found then
      raise exception 'Batch not found.';
    end if;

    -- Replace current items; rows whose Zoho item was removed are kept as history.
    delete from public.sales_order_batch_items
    where batch_id = v_batch_id and sales_order_item_id is not null;
  end if;

  insert into public.sales_order_batch_items
    (batch_id, sales_order_id, sales_order_item_id, box_label, quantity_sent, item_name, item_sku, original_quantity)
  select v_batch_id, p_sales_order_id, i.id, btrim(x.box_label), x.quantity_sent, i.name, i.sku, i.quantity
  from jsonb_to_recordset(p_items) as x(sales_order_item_id uuid, box_label text, quantity_sent numeric)
  join public.sales_order_items i on i.id = x.sales_order_item_id;

  return v_batch_id;
end;
$$;

revoke execute on function public.save_sales_order_batch(uuid, jsonb, uuid) from public, anon;
grant execute on function public.save_sales_order_batch(uuid, jsonb, uuid) to authenticated;
