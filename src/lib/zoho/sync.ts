import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSalesOrder,
  listAllSalesOrders,
  zohoItemImageUrl,
  type ZohoLineItem,
  type ZohoSalesOrder,
} from "./client";

export type SyncResult = {
  fetched: number;
  updated: number;
  deleted: number;
};

// Zoho sends "" for empty values and "+0530"-style offsets; normalise for Postgres.
const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : null);
const num = (value: unknown) => (value === "" || value == null || Number.isNaN(Number(value)) ? null : Number(value));
const timestamp = (value: string) => (value ? value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : null);

function toSalesOrderRow(so: ZohoSalesOrder) {
  // Line items are stored in their own table.
  const raw: Partial<ZohoSalesOrder> = { ...so };
  delete raw.line_items;
  return {
    zoho_salesorder_id: so.salesorder_id,
    salesorder_number: so.salesorder_number,
    reference_number: text(so.reference_number),
    date: text(so.date),
    shipment_date: text(so.shipment_date),
    status: text(so.status),
    order_status: text(so.order_status),
    invoiced_status: text(so.invoiced_status),
    paid_status: text(so.paid_status),
    shipped_status: text(so.shipped_status),
    current_sub_status: text(so.current_sub_status),
    customer_id: text(so.customer_id),
    customer_name: text(so.customer_name),
    salesperson_name: text(so.salesperson_name),
    currency_code: text(so.currency_code),
    currency_symbol: text(so.currency_symbol),
    exchange_rate: num(so.exchange_rate),
    sub_total: num(so.sub_total),
    discount_total: num(so.discount_total),
    tax_total: num(so.tax_total),
    shipping_charge: num(so.shipping_charge),
    adjustment: num(so.adjustment),
    total: num(so.total),
    balance: num(so.balance),
    total_quantity: num(so.total_quantity),
    place_of_supply: text(so.place_of_supply),
    payment_terms_label: text(so.payment_terms_label),
    billing_address: so.billing_address ?? null,
    shipping_address: so.shipping_address ?? null,
    notes: text(so.notes),
    terms: text(so.terms),
    custom_fields: so.custom_fields ?? [],
    zoho_created_time: timestamp(so.created_time),
    zoho_last_modified_time: timestamp(so.last_modified_time),
    raw,
    synced_at: new Date().toISOString(),
  };
}

function toItemRow(salesOrderId: string, li: ZohoLineItem) {
  const hasImage = Boolean(li.item_id && li.image_document_id);
  return {
    sales_order_id: salesOrderId,
    zoho_line_item_id: li.line_item_id,
    zoho_item_id: text(li.item_id),
    item_order: num(li.item_order),
    name: li.name,
    sku: text(li.sku),
    description: text(li.description),
    unit: text(li.unit),
    hsn_or_sac: text(li.hsn_or_sac),
    product_type: text(li.product_type),
    quantity: num(li.quantity),
    quantity_invoiced: num(li.quantity_invoiced),
    rate: num(li.rate),
    discount: num(li.discount),
    discount_amount: num(li.discount_amount),
    tax_id: text(li.tax_id),
    tax_name: text(li.tax_name),
    tax_percentage: num(li.tax_percentage),
    item_sub_total: num(li.item_sub_total),
    item_total: num(li.item_total),
    image_document_id: text(li.image_document_id),
    image_name: text(li.image_name),
    image_type: text(li.image_type),
    image_url: hasImage ? zohoItemImageUrl(li.item_id) : null,
    raw: li,
  };
}

/**
 * Pulls sales orders from Zoho Books into sales_orders / sales_order_items.
 * Only orders whose last_modified_time changed are re-fetched in detail;
 * orders deleted in Zoho are removed locally.
 */
export async function syncSalesOrders({ triggeredBy }: { triggeredBy?: string } = {}): Promise<SyncResult> {
  const db = createAdminClient();

  const { data: run, error: runError } = await db
    .from("zoho_sync_runs")
    .insert({ resource: "sales_orders", triggered_by: triggeredBy ?? null })
    .select("id")
    .single();
  if (runError) throw new Error(`Could not start sync: ${runError.message}`);

  const result: SyncResult = { fetched: 0, updated: 0, deleted: 0 };

  try {
    const summaries = await listAllSalesOrders();
    result.fetched = summaries.length;

    const { data: existing, error: existingError } = await db
      .from("sales_orders")
      .select("id, zoho_salesorder_id, zoho_last_modified_time");
    if (existingError) throw existingError;

    const known = new Map(existing.map((row) => [row.zoho_salesorder_id, row]));

    // 1. Upsert new / changed orders with their line items.
    for (const summary of summaries) {
      const local = known.get(summary.salesorder_id);
      const zohoModified = new Date(timestamp(summary.last_modified_time) ?? 0).getTime();
      const localModified = local?.zoho_last_modified_time ? new Date(local.zoho_last_modified_time).getTime() : -1;
      if (local && zohoModified === localModified) continue;

      const so = await getSalesOrder(summary.salesorder_id);

      const { data: saved, error: orderError } = await db
        .from("sales_orders")
        .upsert(toSalesOrderRow(so), { onConflict: "zoho_salesorder_id" })
        .select("id")
        .single();
      if (orderError) throw new Error(`${so.salesorder_number}: ${orderError.message}`);

      const items = (so.line_items ?? []).map((li) => toItemRow(saved.id, li));
      if (items.length) {
        const { error: itemsError } = await db
          .from("sales_order_items")
          .upsert(items, { onConflict: "zoho_line_item_id" });
        if (itemsError) throw new Error(`${so.salesorder_number} items: ${itemsError.message}`);
      }

      // Remove line items that were deleted from the order in Zoho.
      let staleItems = db.from("sales_order_items").delete().eq("sales_order_id", saved.id);
      if (items.length) {
        staleItems = staleItems.not("zoho_line_item_id", "in", `(${items.map((i) => i.zoho_line_item_id).join(",")})`);
      }
      const { error: staleError } = await staleItems;
      if (staleError) throw new Error(`${so.salesorder_number} cleanup: ${staleError.message}`);

      result.updated++;
    }

    // 2. Remove orders that no longer exist in Zoho (items cascade).
    const zohoIds = new Set(summaries.map((s) => s.salesorder_id));
    const removedIds = existing.filter((row) => !zohoIds.has(row.zoho_salesorder_id)).map((row) => row.id);
    if (removedIds.length) {
      const { error: deleteError } = await db.from("sales_orders").delete().in("id", removedIds);
      if (deleteError) throw deleteError;
      result.deleted = removedIds.length;
    }

    await db
      .from("zoho_sync_runs")
      .update({
        status: "success",
        orders_fetched: result.fetched,
        orders_updated: result.updated,
        orders_deleted: result.deleted,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("zoho_sync_runs")
      .update({
        status: "failed",
        orders_fetched: result.fetched,
        orders_updated: result.updated,
        orders_deleted: result.deleted,
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw new Error(message);
  }
}
