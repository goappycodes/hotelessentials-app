import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getContact,
  getEstimate,
  getSalesOrder,
  listAllEstimates,
  listAllSalesOrders,
  zohoItemImageUrl,
  type ZohoContact,
  type ZohoEstimate,
  type ZohoLineItem,
  type ZohoSalesOrder,
} from "./client";

export type SyncResult = {
  fetched: number;
  updated: number;
  deleted: number;
};

type AdminClient = ReturnType<typeof createAdminClient>;

// Zoho sends "" for empty values and "+0530"-style offsets; normalise for Postgres.
const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : null);
const num = (value: unknown) => (value === "" || value == null || Number.isNaN(Number(value)) ? null : Number(value));
const timestamp = (value: string) => (value ? value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2") : null);
const hasAddress = (address?: Record<string, string> | null): address is Record<string, string> =>
  !!address && Object.values(address).some((v) => typeof v === "string" && v.trim() !== "");

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
 * Saves one Zoho sales order locally: the order and its line items (removing items deleted in Zoho).
 * Shared by the Sync button and the Zoho webhook so both write identical data. Line items are upserted
 * by their Zoho id, so an item keeps its local id — and the dispatch batches that point at it — across updates.
 */
async function saveSalesOrder(db: AdminClient, so: ZohoSalesOrder) {
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
}

type RunCounts = { fetched: number; updated: number; deleted: number };
const SAVED: RunCounts = { fetched: 1, updated: 1, deleted: 0 };

/**
 * Runs one webhook-triggered operation on a single record and logs it in zoho_sync_runs, like a Sync-button run.
 * `counts` says what to record for the run (by default: one record fetched and saved).
 * Any failure is recorded on the run and re-thrown so the webhook replies with an error (and Zoho retries).
 */
async function runWebhookSync<T>(
  resource: "quotes" | "sales_orders",
  work: (db: AdminClient) => Promise<T>,
  counts: (result: T) => RunCounts = () => SAVED,
): Promise<T> {
  const db = createAdminClient();

  const { data: run, error: runError } = await db.from("zoho_sync_runs").insert({ resource }).select("id").single();
  if (runError) throw new Error(`Could not log webhook run: ${runError.message}`);

  try {
    const result = await work(db);
    const { fetched, updated, deleted } = counts(result);
    await db
      .from("zoho_sync_runs")
      .update({
        status: "success",
        orders_fetched: fetched,
        orders_updated: updated,
        orders_deleted: deleted,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("zoho_sync_runs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", run.id);
    throw new Error(message);
  }
}

// Zoho ids are long numeric strings; the id is spliced into a Zoho API path, so accept nothing else.
const isZohoId = (id: string) => /^\d{5,25}$/.test(id);

export type SalesOrderWebhookResult = { action: "created" | "updated"; salesorder_number: string };

/**
 * Zoho webhook entry point for sales orders: re-fetches one sales order from Zoho and saves it, creating
 * the local order if it is new or updating it if it already exists. The webhook body is only used to find
 * the salesorder id; the data itself always comes from the Zoho API, exactly as in the Sync button.
 */
export async function syncSalesOrderFromWebhook(salesorderId: string): Promise<SalesOrderWebhookResult> {
  if (!isZohoId(salesorderId)) throw new Error("Invalid sales order id");

  return runWebhookSync("sales_orders", async (db) => {
    const so = await getSalesOrder(salesorderId);

    const { data: existing, error: existingError } = await db
      .from("sales_orders")
      .select("id")
      .eq("zoho_salesorder_id", so.salesorder_id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    await saveSalesOrder(db, so);

    return { action: existing ? "updated" : "created", salesorder_number: so.salesorder_number };
  });
}

export type SalesOrderDeleteResult = { action: "deleted"; salesorder_number: string } | { action: "not_found" };

/**
 * Zoho webhook entry point for a sales order deleted in Zoho: removes the local copy. Makes no request to
 * Zoho. The order's line items go with it, and so do its dispatch batches (the database cascades), exactly
 * as when the Sync button removes an order that no longer exists in Zoho. Deleting an order that is already
 * gone is not an error, so a retried delivery still succeeds.
 */
export async function deleteSalesOrderFromWebhook(salesOrderId: string): Promise<SalesOrderDeleteResult> {
  if (!isZohoId(salesOrderId)) throw new Error("Invalid sales order id");

  return runWebhookSync(
    "sales_orders",
    async (db): Promise<SalesOrderDeleteResult> => {
      const { data, error } = await db
        .from("sales_orders")
        .delete()
        .eq("zoho_salesorder_id", salesOrderId)
        .select("id, salesorder_number");
      if (error) throw new Error(error.message);

      return data.length ? { action: "deleted", salesorder_number: data[0].salesorder_number } : { action: "not_found" };
    },
    (result) => ({ fetched: 0, updated: 0, deleted: result.action === "deleted" ? 1 : 0 }),
  );
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
      await saveSalesOrder(db, so);

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

// Quotes (Zoho Books "estimates") ---------------------------------------------

function toQuoteRow(est: ZohoEstimate) {
  // Line items are stored in their own table.
  const raw: Partial<ZohoEstimate> = { ...est };
  delete raw.line_items;
  return {
    zoho_estimate_id: est.estimate_id,
    estimate_number: est.estimate_number,
    reference_number: text(est.reference_number),
    date: text(est.date),
    expiry_date: text(est.expiry_date),
    status: text(est.status),
    current_sub_status: text(est.current_sub_status),
    customer_id: text(est.customer_id),
    customer_name: text(est.customer_name),
    salesperson_name: text(est.salesperson_name),
    currency_code: text(est.currency_code),
    currency_symbol: text(est.currency_symbol),
    exchange_rate: num(est.exchange_rate),
    sub_total: num(est.sub_total),
    discount_total: num(est.discount_total),
    tax_total: num(est.tax_total),
    shipping_charge: num(est.shipping_charge),
    adjustment: num(est.adjustment),
    total: num(est.total),
    total_quantity: num(est.total_quantity),
    place_of_supply: text(est.place_of_supply),
    payment_terms_label: text(est.payment_terms_label),
    billing_address: est.billing_address ?? null,
    shipping_address: est.shipping_address ?? null,
    notes: text(est.notes),
    terms: text(est.terms),
    custom_fields: est.custom_fields ?? [],
    zoho_created_time: timestamp(est.created_time),
    zoho_last_modified_time: timestamp(est.last_modified_time),
    raw,
    synced_at: new Date().toISOString(),
  };
}

function toQuoteItemRow(quoteId: string, li: ZohoLineItem) {
  const hasImage = Boolean(li.item_id && li.image_document_id);
  return {
    quote_id: quoteId,
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
 * Saves one Zoho estimate locally: the quote, its line items (removing items deleted in Zoho) and the
 * customer's addresses. Shared by the Sync button and the Zoho webhook so both write identical data.
 * `contactCache` lets a bulk sync look each customer up only once.
 */
async function saveQuote(db: AdminClient, est: ZohoEstimate, contactCache: Map<string, ZohoContact | null>) {
  const row = toQuoteRow(est);

  // Pull the customer's billing / shipping address from their contact record,
  // falling back to whatever the estimate itself carries.
  if (est.customer_id) {
    let contact = contactCache.get(est.customer_id);
    if (contact === undefined) {
      try {
        contact = await getContact(est.customer_id);
      } catch {
        contact = null;
      }
      contactCache.set(est.customer_id, contact);
    }
    if (contact) {
      if (hasAddress(contact.billing_address)) row.billing_address = contact.billing_address;
      if (hasAddress(contact.shipping_address)) row.shipping_address = contact.shipping_address;
    }
  }

  const { data: saved, error: quoteError } = await db
    .from("quotes")
    .upsert(row, { onConflict: "zoho_estimate_id" })
    .select("id")
    .single();
  if (quoteError) throw new Error(`${est.estimate_number}: ${quoteError.message}`);

  const items = (est.line_items ?? []).map((li) => toQuoteItemRow(saved.id, li));
  if (items.length) {
    const { error: itemsError } = await db
      .from("quote_items")
      .upsert(items, { onConflict: "zoho_line_item_id" });
    if (itemsError) throw new Error(`${est.estimate_number} items: ${itemsError.message}`);
  }

  // Remove line items that were deleted from the quote in Zoho.
  let staleItems = db.from("quote_items").delete().eq("quote_id", saved.id);
  if (items.length) {
    staleItems = staleItems.not("zoho_line_item_id", "in", `(${items.map((i) => i.zoho_line_item_id).join(",")})`);
  }
  const { error: staleError } = await staleItems;
  if (staleError) throw new Error(`${est.estimate_number} cleanup: ${staleError.message}`);
}

export type QuoteWebhookResult = { action: "created" | "updated"; estimate_number: string };

/**
 * Zoho webhook entry point: re-fetches one estimate from Zoho and saves it, creating the local quote if
 * it is new or updating it if it already exists. The webhook body is only used to find the estimate id;
 * the data itself always comes from the Zoho API, exactly as in the Sync button. Logged like a sync run.
 */
export async function syncQuoteFromWebhook(estimateId: string): Promise<QuoteWebhookResult> {
  if (!isZohoId(estimateId)) throw new Error("Invalid estimate id");

  return runWebhookSync("quotes", async (db) => {
    const est = await getEstimate(estimateId);

    const { data: existing, error: existingError } = await db
      .from("quotes")
      .select("id")
      .eq("zoho_estimate_id", est.estimate_id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    await saveQuote(db, est, new Map());

    return { action: existing ? "updated" : "created", estimate_number: est.estimate_number };
  });
}

export type QuoteDeleteResult = { action: "deleted"; estimate_number: string } | { action: "not_found" };

/**
 * Zoho webhook entry point for a quote deleted in Zoho: removes the local copy and its line items. Makes no
 * request to Zoho. Deleting a quote that is already gone is not an error, so a retried delivery still succeeds.
 */
export async function deleteQuoteFromWebhook(estimateId: string): Promise<QuoteDeleteResult> {
  if (!isZohoId(estimateId)) throw new Error("Invalid quote id");

  return runWebhookSync(
    "quotes",
    async (db): Promise<QuoteDeleteResult> => {
      const { data, error } = await db
        .from("quotes")
        .delete()
        .eq("zoho_estimate_id", estimateId)
        .select("id, estimate_number");
      if (error) throw new Error(error.message);

      return data.length ? { action: "deleted", estimate_number: data[0].estimate_number } : { action: "not_found" };
    },
    (result) => ({ fetched: 0, updated: 0, deleted: result.action === "deleted" ? 1 : 0 }),
  );
}

/**
 * Pulls quotes (estimates) from Zoho Books into quotes / quote_items.
 * Read-only: only fetches from Zoho and never writes back. Only estimates whose
 * last_modified_time changed are re-fetched in detail; estimates deleted in Zoho
 * are removed locally.
 */
export async function syncQuotes({ triggeredBy }: { triggeredBy?: string } = {}): Promise<SyncResult> {
  const db = createAdminClient();

  const { data: run, error: runError } = await db
    .from("zoho_sync_runs")
    .insert({ resource: "quotes", triggered_by: triggeredBy ?? null })
    .select("id")
    .single();
  if (runError) throw new Error(`Could not start sync: ${runError.message}`);

  const result: SyncResult = { fetched: 0, updated: 0, deleted: 0 };

  try {
    const summaries = await listAllEstimates();
    result.fetched = summaries.length;

    const { data: existing, error: existingError } = await db
      .from("quotes")
      .select("id, zoho_estimate_id, zoho_last_modified_time");
    if (existingError) throw existingError;

    const known = new Map(existing.map((row) => [row.zoho_estimate_id, row]));

    // Customer addresses are looked up once per contact and reused across quotes.
    const contactCache = new Map<string, ZohoContact | null>();

    // 1. Upsert new / changed quotes with their line items.
    for (const summary of summaries) {
      const local = known.get(summary.estimate_id);
      const zohoModified = new Date(timestamp(summary.last_modified_time) ?? 0).getTime();
      const localModified = local?.zoho_last_modified_time ? new Date(local.zoho_last_modified_time).getTime() : -1;
      if (local && zohoModified === localModified) continue;

      const est = await getEstimate(summary.estimate_id);
      await saveQuote(db, est, contactCache);

      result.updated++;
    }

    // 2. Remove quotes that no longer exist in Zoho (items cascade).
    const zohoIds = new Set(summaries.map((s) => s.estimate_id));
    const removedIds = existing.filter((row) => !zohoIds.has(row.zoho_estimate_id)).map((row) => row.id);
    if (removedIds.length) {
      const { error: deleteError } = await db.from("quotes").delete().in("id", removedIds);
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
