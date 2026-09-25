import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderQuotePdf, type QuotePdfItem } from "@/lib/pdf/quote-pdf";
import { fetchItemImage, pickField, sanitizeFilename } from "@/lib/pdf/route-helpers";

// Generating the PDF fetches each item's image from Zoho (rate-limited), so allow time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type QuoteItemRow = {
  item_order: number | null;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: number | null;
  rate: number | null;
  item_sub_total: number | null;
  tax_percentage: number | null;
  zoho_item_id: string | null;
  image_document_id: string | null;
};

type QuoteRow = {
  estimate_number: string;
  date: string | null;
  customer_name: string | null;
  billing_address: Record<string, string> | null;
  currency_code: string | null;
  sub_total: number | null;
  tax_total: number | null;
  total: number | null;
  custom_fields: Array<{ label?: string; value?: unknown }> | null;
  raw: Record<string, unknown> | null;
  quote_items: QuoteItemRow[];
};


export async function GET(_request: NextRequest, ctx: RouteContext<"/dashboard/quotes/[id]/pdf">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Invalid quote id", { status: 400 });

  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "estimate_number, date, customer_name, billing_address, currency_code, sub_total, tax_total, total, custom_fields, raw, " +
        "quote_items(item_order, name, sku, description, quantity, rate, item_sub_total, tax_percentage, zoho_item_id, image_document_id)",
    )
    .eq("id", id)
    .order("item_order", { referencedTable: "quote_items", ascending: true })
    .maybeSingle<QuoteRow>();

  if (!quote) return new Response("Not found", { status: 404 });

  // Fetch item images from Zoho (read-only). Items without an image are skipped.
  const items: QuotePdfItem[] = [];
  for (const row of quote.quote_items) {
    const image = await fetchItemImage(row.zoho_item_id, row.image_document_id);
    items.push({
      item_order: row.item_order,
      name: row.name,
      sku: row.sku,
      description: row.description,
      quantity: row.quantity,
      rate: row.rate,
      item_sub_total: row.item_sub_total,
      tax_percentage: row.tax_percentage,
      image,
    });
  }

  const raw = quote.raw ?? null;
  const billing = quote.billing_address ?? {};

  const pdf = await renderQuotePdf({
    estimate_number: quote.estimate_number,
    date: quote.date,
    customer_name: quote.customer_name,
    billing_address: quote.billing_address,
    phone: (typeof billing.phone === "string" && billing.phone.trim()) || null,
    pan_no: pickField(raw, quote.custom_fields, ["pan_no", "cf_pan_no", "customer_pan_no"], /pan/i),
    gst_no: pickField(raw, quote.custom_fields, ["gst_no", "cf_gst_no", "customer_gst_no"], /gst/i),
    currency_code: quote.currency_code,
    sub_total: quote.sub_total,
    tax_total: quote.tax_total,
    total: quote.total,
    items,
  });

  const filename = sanitizeFilename(quote.customer_name || quote.estimate_number) || quote.estimate_number;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // "inline" opens the PDF in the browser's viewer (new tab) instead of
      // forcing an immediate download; the user can then save it themselves.
      "Content-Disposition": `inline; filename="${filename}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
