import "server-only";
import { createClient } from "@/lib/supabase/server";

export type DispatchRow = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  itemOrder: number | null;
  zohoItemId: string | null;
  imageUrl: string | null;
  imageDocumentId: string | null;
  originalQuantity: number;
  /** Sent in all other batches (excludes the batch being edited). */
  sentElsewhere: number;
  box: string;
  quantity: string;
};

type OrderWithItems = {
  id: string;
  salesorder_number: string;
  customer_name: string | null;
  sales_order_items: {
    id: string;
    name: string;
    sku: string | null;
    unit: string | null;
    item_order: number | null;
    zoho_item_id: string | null;
    image_url: string | null;
    image_document_id: string | null;
    quantity: number | null;
  }[];
};

/** Loads a sales order's items with dispatch totals, optionally prefilled from an existing batch. */
export async function getDispatchForm(salesOrderId: string, batchId?: string) {
  const supabase = await createClient();

  const [{ data: order }, { data: totals }, { data: batchItems }] = await Promise.all([
    supabase
      .from("sales_orders")
      .select(
        "id, salesorder_number, customer_name, sales_order_items(id, name, sku, unit, item_order, zoho_item_id, image_url, image_document_id, quantity)",
      )
      .eq("id", salesOrderId)
      .maybeSingle<OrderWithItems>(),
    supabase.from("sales_order_item_dispatch").select("sales_order_item_id, quantity_sent").eq("sales_order_id", salesOrderId),
    batchId
      ? supabase.from("sales_order_batch_items").select("sales_order_item_id, box_label, quantity_sent").eq("batch_id", batchId)
      : Promise.resolve({ data: [] as { sales_order_item_id: string | null; box_label: string; quantity_sent: number }[] }),
  ]);

  if (!order) return null;

  const sentByItem = new Map((totals ?? []).map((t) => [t.sales_order_item_id, Number(t.quantity_sent)]));
  const inBatch = new Map((batchItems ?? []).map((b) => [b.sales_order_item_id, b]));

  const rows: DispatchRow[] = order.sales_order_items
    .sort((a, b) => (a.item_order ?? 0) - (b.item_order ?? 0))
    .map((item) => {
      const current = inBatch.get(item.id);
      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        itemOrder: item.item_order,
        zohoItemId: item.zoho_item_id,
        imageUrl: item.image_url,
        imageDocumentId: item.image_document_id,
        originalQuantity: Number(item.quantity ?? 0),
        sentElsewhere: (sentByItem.get(item.id) ?? 0) - Number(current?.quantity_sent ?? 0),
        box: current?.box_label ?? "",
        quantity: current ? String(current.quantity_sent) : "",
      };
    });

  return { order, rows };
}
