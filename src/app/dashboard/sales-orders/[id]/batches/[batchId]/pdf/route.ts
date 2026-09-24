import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderDispatchPdf, type DispatchPdfItem } from "@/lib/pdf/dispatch-pdf";
import type { PdfImage } from "@/lib/pdf/shared";
import { fetchItemImage, pickField, sanitizeFilename } from "@/lib/pdf/route-helpers";

// Generating the PDF fetches each item's image from Zoho (rate-limited), so allow time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type BatchItemRow = {
  box_label: string;
  quantity_sent: number;
  item_name: string;
  sales_order_item_id: string | null;
  sales_order_items: { item_order: number | null; zoho_item_id: string | null; image_document_id: string | null } | null;
};

type OrderRow = {
  billing_address: Record<string, string> | null;
  custom_fields: Array<{ label?: string; value?: unknown }> | null;
  raw: Record<string, unknown> | null;
};

export async function GET(_request: NextRequest, ctx: RouteContext<"/dashboard/sales-orders/[id]/batches/[batchId]/pdf">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id, batchId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(batchId)) {
    return new Response("Invalid batch id", { status: 400 });
  }

  const [{ data: batch }, { data: order }, { data: items }] = await Promise.all([
    supabase
      .from("sales_order_batch_summaries")
      .select("batch_number, sales_order_id, salesorder_number, customer_name, created_at")
      .eq("id", batchId)
      .maybeSingle(),
    supabase.from("sales_orders").select("billing_address, custom_fields, raw").eq("id", id).maybeSingle<OrderRow>(),
    supabase
      .from("sales_order_batch_items")
      .select(
        "box_label, quantity_sent, item_name, sales_order_item_id, sales_order_items(item_order, zoho_item_id, image_document_id)",
      )
      .eq("batch_id", batchId)
      .returns<BatchItemRow[]>(),
  ]);

  if (!batch || batch.sales_order_id !== id || !order) return new Response("Not found", { status: 404 });

  // Remaining = still to be sent across ALL dispatches of the order (same figure as the
  // batch page's "Remaining (all batches)"). The view reports sent − ordered, so pending is
  // its negation; over-sent items show 0.
  const itemIds = (items ?? []).map((i) => i.sales_order_item_id).filter((v): v is string => Boolean(v));
  const { data: totals } = itemIds.length
    ? await supabase.from("sales_order_item_dispatch").select("sales_order_item_id, remaining").in("sales_order_item_id", itemIds)
    : { data: [] };
  const remainingByItem = new Map((totals ?? []).map((t) => [t.sales_order_item_id, Math.max(0, -Number(t.remaining))]));

  // Same grouping as the batch page: by box (natural sort, so "Box 2" comes before "Box 10"),
  // then by the order's line-item sequence; items removed in Zoho go last within their box.
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const sorted = [...(items ?? [])].sort(
    (a, b) =>
      collator.compare(a.box_label, b.box_label) ||
      (a.sales_order_items?.item_order ?? Infinity) - (b.sales_order_items?.item_order ?? Infinity),
  );

  // Item pictures come from Zoho (one request per distinct item; the same item is never fetched twice).
  const images = new Map<string, PdfImage | null>();
  const pdfItems: DispatchPdfItem[] = [];
  for (const i of sorted) {
    const zohoItemId = i.sales_order_items?.zoho_item_id ?? null;
    let image: PdfImage | null = null;
    if (zohoItemId) {
      if (!images.has(zohoItemId)) {
        images.set(zohoItemId, await fetchItemImage(zohoItemId, i.sales_order_items?.image_document_id ?? null));
      }
      image = images.get(zohoItemId) ?? null;
    }
    pdfItems.push({
      box: i.box_label,
      name: i.item_name,
      image,
      quantity_sent: Number(i.quantity_sent),
      quantity_remaining: i.sales_order_item_id ? (remainingByItem.get(i.sales_order_item_id) ?? null) : null,
    });
  }

  const billing = order.billing_address ?? {};

  const pdf = await renderDispatchPdf({
    batch_number: batch.batch_number,
    salesorder_number: batch.salesorder_number,
    // created_at is a timestamp; take its calendar date in IST (as the dashboard does), not UTC.
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(batch.created_at)),
    customer_name: batch.customer_name,
    billing_address: order.billing_address,
    phone: (typeof billing.phone === "string" && billing.phone.trim()) || null,
    pan_no: pickField(order.raw, order.custom_fields, ["pan_no", "cf_pan_no", "customer_pan_no"], /pan/i),
    gst_no: pickField(order.raw, order.custom_fields, ["gst_no", "cf_gst_no", "customer_gst_no"], /gst/i),
    items: pdfItems,
  });

  const filename = sanitizeFilename(batch.batch_number) || "dispatch";

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // "inline" opens the PDF in the browser's viewer (new tab) instead of forcing a download.
      "Content-Disposition": `inline; filename="${filename}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
