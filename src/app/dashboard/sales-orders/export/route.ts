import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSalesOrdersItemsXlsx, remainingItemSheets, type ItemDispatch } from "@/lib/excel/sales-order-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Supabase returns at most 1000 rows per request, so larger result sets are read page by page.
const PAGE_SIZE = 1000;
// Keeps the `in (…)` filter, and so the request URL, short.
const ID_CHUNK = 100;

type OrderRow = {
  id: string;
  salesorder_number: string;
  sales_order_items: {
    id: string;
    item_order: number | null;
    name: string;
    hsn_or_sac: string | null;
    quantity: number | null;
  }[];
};

type PendingRow = ItemDispatch & { sales_order_item_id: string };

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const text = (message: string, status: number) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** Remaining items of the sales orders dated within [from, to], one sheet per order. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return text("Unauthorized", 401);

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!isIsoDate(from) || !isIsoDate(to)) return text("Choose a valid start and end date.", 400);
  if (from > to) return text("The start date must be on or before the end date.", 400);

  // Sales orders in the range (by order date), with their line items. Voided orders have nothing left to send.
  const orders: OrderRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("sales_orders")
      .select("id, salesorder_number, sales_order_items(id, item_order, name, hsn_or_sac, quantity)")
      .gte("date", from)
      .lte("date", to)
      .or("status.is.null,status.neq.void")
      .order("date", { ascending: true })
      .order("salesorder_number", { ascending: true })
      .order("id", { ascending: true })
      .order("item_order", { referencedTable: "sales_order_items", ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<OrderRow[]>();
    if (error) return text(`Could not load sales orders: ${error.message}`, 500);
    orders.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  // Items still to be sent: the view reports remaining as sent − ordered, so < 0 means quantity is left.
  const ids = orders.map((o) => o.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));

  const pending = new Map<string, ItemDispatch>();
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const rows: PendingRow[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("sales_order_item_dispatch")
          .select("sales_order_item_id, quantity_sent, remaining")
          .in("sales_order_id", chunk)
          .lt("remaining", 0)
          .order("sales_order_item_id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)
          .returns<PendingRow[]>();
        if (error) return { rows: null, failure: error.message };
        rows.push(...data);
        if (data.length < PAGE_SIZE) return { rows, failure: null };
      }
    }),
  );
  for (const result of results) {
    if (!result.rows) return text(`Could not load dispatch totals: ${result.failure}`, 500);
    for (const row of result.rows) pending.set(row.sales_order_item_id, row);
  }

  const sheets = remainingItemSheets(orders, pending);
  if (!sheets.length) return text("No remaining items were found for sales orders in this date range.", 404);

  const xlsx = await buildSalesOrdersItemsXlsx(sheets);

  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Remaining items ${from} to ${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
