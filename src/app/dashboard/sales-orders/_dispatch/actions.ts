"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type BatchFormState = { error?: string };

type ItemInput = { sales_order_item_id: string; box_label: string; quantity_sent: number };

const UUID = /^[0-9a-f-]{36}$/i;

export async function saveBatch(_prev: BatchFormState, formData: FormData): Promise<BatchFormState> {
  const salesOrderId = String(formData.get("sales_order_id") ?? "");
  const batchId = String(formData.get("batch_id") ?? "") || null;
  if (!UUID.test(salesOrderId) || (batchId && !UUID.test(batchId))) return { error: "Invalid request." };

  let items: ItemInput[];
  try {
    const parsed = JSON.parse(String(formData.get("items") ?? "[]")) as { id: string; box: string; quantity: string }[];
    items = parsed
      .map((row) => ({
        sales_order_item_id: row.id,
        box_label: String(row.box ?? "").trim(),
        quantity_sent: Number(row.quantity),
      }))
      .filter((row) => Number.isFinite(row.quantity_sent) && row.quantity_sent > 0);
  } catch {
    return { error: "Invalid request." };
  }

  if (items.length === 0) return { error: "Enter a sent quantity for at least one item." };
  if (items.some((row) => !row.box_label)) return { error: "Add box info for every item being sent." };

  const supabase = await createClient();
  const { data: savedId, error } = await supabase.rpc("save_sales_order_batch", {
    p_sales_order_id: salesOrderId,
    p_items: items,
    ...(batchId ? { p_batch_id: batchId } : {}),
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/sales-orders", "layout");
  redirect(`/dashboard/sales-orders/${salesOrderId}/batches/${savedId}`);
}

export async function deleteBatch(formData: FormData) {
  const batchId = String(formData.get("batch_id") ?? "");
  const salesOrderId = String(formData.get("sales_order_id") ?? "");
  if (!UUID.test(batchId)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("sales_order_batches").delete().eq("id", batchId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/sales-orders", "layout");
  redirect(UUID.test(salesOrderId) ? `/dashboard/sales-orders/${salesOrderId}/batches` : "/dashboard/sales-orders");
}
