-- =============================================================================
-- Migration: create_sales_order_dispatch_status
-- Internal dispatch status per sales order, derived from dispatch batches
-- (always current, never stored):
--   pending   → at least one item still has quantity to send (remaining < 0)
--   fulfilled → every item is fully sent (remaining >= 0, over-sent included)
--   null      → order has no line items
-- =============================================================================

create view public.sales_order_dispatch_summary
with (security_invoker = true) as
select
  so.id                                                        as sales_order_id,
  count(d.sales_order_item_id)::integer                        as item_count,
  coalesce(sum(d.original_quantity), 0)                        as total_quantity,
  coalesce(sum(d.quantity_sent), 0)                            as quantity_sent,
  (count(*) filter (where d.remaining < 0))::integer           as pending_item_count,
  case
    when count(d.sales_order_item_id) = 0 then null
    when count(*) filter (where d.remaining < 0) = 0 then 'fulfilled'
    else 'pending'
  end                                                          as dispatch_status
from public.sales_orders so
left join public.sales_order_item_dispatch d on d.sales_order_id = so.id
group by so.id;

-- Sales order list: order columns + dispatch summary, so the list can filter and sort by it.
create view public.sales_order_list
with (security_invoker = true) as
select
  so.id,
  so.salesorder_number,
  so.reference_number,
  so.date,
  so.customer_name,
  so.salesperson_name,
  so.status,
  so.invoiced_status,
  so.shipped_status,
  so.currency_code,
  so.total,
  ds.item_count,
  ds.total_quantity,
  ds.quantity_sent,
  ds.pending_item_count,
  ds.dispatch_status
from public.sales_orders so
join public.sales_order_dispatch_summary ds on ds.sales_order_id = so.id;
