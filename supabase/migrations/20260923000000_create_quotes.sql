-- =============================================================================
-- Migration: create_quotes
-- Local copy of Zoho Books quotes (estimates) and their line items.
-- Read-only mirror: rows are written only by the server (service role) during
-- Zoho sync, which never writes back to Zoho. Item images stay in Zoho;
-- image_url stores the Zoho Books image link.
-- Sync runs are logged in the shared public.zoho_sync_runs table
-- (resource = 'quotes'), created by the sales_orders migration.
-- =============================================================================

-- Quotes ------------------------------------------------------------------------
create table public.quotes (
  id                       uuid primary key default gen_random_uuid(),
  zoho_estimate_id         text not null unique,
  estimate_number          text not null,
  reference_number         text,
  date                     date,
  expiry_date              date,

  status                   text,
  current_sub_status       text,

  customer_id              text,
  customer_name            text,
  salesperson_name         text,

  currency_code            text,
  currency_symbol          text,
  exchange_rate            numeric,

  sub_total                numeric,
  discount_total           numeric,
  tax_total                numeric,
  shipping_charge          numeric,
  adjustment               numeric,
  total                    numeric,
  total_quantity           numeric,

  place_of_supply          text,
  payment_terms_label      text,
  billing_address          jsonb,
  shipping_address         jsonb,
  notes                    text,
  terms                    text,
  custom_fields            jsonb,

  zoho_created_time        timestamptz,
  zoho_last_modified_time  timestamptz,
  raw                      jsonb not null,   -- full Zoho payload
  synced_at                timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index quotes_date_idx on public.quotes (date desc);
create index quotes_status_idx on public.quotes (status);
create index quotes_customer_name_idx on public.quotes (customer_name);

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- Quote items -----------------------------------------------------------------
create table public.quote_items (
  id                  uuid primary key default gen_random_uuid(),
  quote_id            uuid not null references public.quotes (id) on delete cascade,
  zoho_line_item_id   text not null unique,
  zoho_item_id        text,
  item_order          integer,

  name                text not null,
  sku                 text,
  description         text,
  unit                text,
  hsn_or_sac          text,
  product_type        text,

  quantity            numeric,
  rate                numeric,
  discount            numeric,
  discount_amount     numeric,
  tax_id              text,
  tax_name            text,
  tax_percentage      numeric,
  item_sub_total      numeric,
  item_total          numeric,

  image_document_id   text,
  image_name          text,
  image_type          text,
  image_url           text,               -- Zoho Books image link (requires Zoho OAuth token)

  raw                 jsonb not null,     -- full Zoho line item payload
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index quote_items_quote_id_idx on public.quote_items (quote_id);
create index quote_items_zoho_item_id_idx on public.quote_items (zoho_item_id);

create trigger quote_items_set_updated_at
  before update on public.quote_items
  for each row execute function public.set_updated_at();

-- Quote list: quote columns + item aggregates, so the list can show counts. -----
create view public.quote_list
with (security_invoker = true) as
select
  q.id,
  q.estimate_number,
  q.reference_number,
  q.date,
  q.expiry_date,
  q.customer_name,
  q.salesperson_name,
  q.status,
  q.currency_code,
  q.total,
  count(qi.id)::integer                          as item_count,
  coalesce(sum(qi.quantity), 0)                  as total_quantity
from public.quotes q
left join public.quote_items qi on qi.quote_id = q.id
group by q.id;

-- Row Level Security: signed-in users can read; only the service role writes. ----
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;

create policy "Authenticated users can view quotes"
  on public.quotes for select
  to authenticated
  using (true);

create policy "Authenticated users can view quote items"
  on public.quote_items for select
  to authenticated
  using (true);
