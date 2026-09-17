-- =============================================================================
-- Migration: create_sales_orders
-- Local copy of Zoho Books sales orders and their line items, plus a sync log.
-- Item images stay in Zoho; image_url stores the Zoho Books image link.
-- Rows are written only by the server (service role) during Zoho sync.
-- =============================================================================

-- Sales orders ------------------------------------------------------------------
create table public.sales_orders (
  id                       uuid primary key default gen_random_uuid(),
  zoho_salesorder_id       text not null unique,
  salesorder_number        text not null,
  reference_number         text,
  date                     date,
  shipment_date            date,

  status                   text,
  order_status             text,
  invoiced_status          text,
  paid_status              text,
  shipped_status           text,
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
  balance                  numeric,
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

create index sales_orders_date_idx on public.sales_orders (date desc);
create index sales_orders_status_idx on public.sales_orders (status);
create index sales_orders_customer_name_idx on public.sales_orders (customer_name);

create trigger sales_orders_set_updated_at
  before update on public.sales_orders
  for each row execute function public.set_updated_at();

-- Sales order items -----------------------------------------------------------
create table public.sales_order_items (
  id                  uuid primary key default gen_random_uuid(),
  sales_order_id      uuid not null references public.sales_orders (id) on delete cascade,
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
  quantity_invoiced   numeric,
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

create index sales_order_items_sales_order_id_idx on public.sales_order_items (sales_order_id);
create index sales_order_items_zoho_item_id_idx on public.sales_order_items (zoho_item_id);

create trigger sales_order_items_set_updated_at
  before update on public.sales_order_items
  for each row execute function public.set_updated_at();

-- Sync log ----------------------------------------------------------------------
create table public.zoho_sync_runs (
  id               bigint generated always as identity primary key,
  resource         text not null default 'sales_orders',
  status           text not null default 'running' check (status in ('running', 'success', 'failed')),
  orders_fetched   integer not null default 0,
  orders_updated   integer not null default 0,
  orders_deleted   integer not null default 0,
  error            text,
  triggered_by     uuid references auth.users (id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index zoho_sync_runs_started_at_idx on public.zoho_sync_runs (resource, started_at desc);

-- Row Level Security: signed-in users can read; only the service role writes. ----
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
alter table public.zoho_sync_runs enable row level security;

create policy "Authenticated users can view sales orders"
  on public.sales_orders for select
  to authenticated
  using (true);

create policy "Authenticated users can view sales order items"
  on public.sales_order_items for select
  to authenticated
  using (true);

create policy "Authenticated users can view sync runs"
  on public.zoho_sync_runs for select
  to authenticated
  using (true);
