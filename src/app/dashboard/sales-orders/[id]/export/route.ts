import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildSalesOrderItemsXlsx, toExportRow } from "@/lib/excel/sales-order-items";
import { sanitizeFilename } from "@/lib/pdf/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderRow = {
  salesorder_number: string;
  sales_order_items: {
    id: string;
    item_order: number | null;
    name: string;
    hsn_or_sac: string | null;
    quantity: number | null;
  }[];
};

export async function GET(_request: NextRequest, ctx: RouteContext<"/dashboard/sales-orders/[id]/export">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Invalid sales order id", { status: 400 });

  const [{ data: order }, { data: dispatch }] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("salesorder_number, sales_order_items(id, item_order, name, hsn_or_sac, quantity)")
      .eq("id", id)
      .order("item_order", { referencedTable: "sales_order_items", ascending: true })
      .maybeSingle<OrderRow>(),
    supabase.from("sales_order_item_dispatch").select("sales_order_item_id, quantity_sent, remaining").eq("sales_order_id", id),
  ]);

  if (!order) return new Response("Not found", { status: 404 });

  const dispatchByItem = new Map((dispatch ?? []).map((d) => [d.sales_order_item_id, d]));
  const rows = order.sales_order_items.map((item, index) => toExportRow(item, index, dispatchByItem.get(item.id)));

  const xlsx = await buildSalesOrderItemsXlsx(rows);
  const filename = sanitizeFilename(`${order.salesorder_number} items`) || "sales-order-items";

  return new Response(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
