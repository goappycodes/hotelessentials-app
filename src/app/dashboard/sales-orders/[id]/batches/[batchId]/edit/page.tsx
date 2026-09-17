import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BatchForm } from "@/app/dashboard/sales-orders/_dispatch/batch-form";
import { getDispatchForm } from "@/app/dashboard/sales-orders/_dispatch/data";

export const metadata: Metadata = { title: "Edit Batch" };

export default async function EditBatchPage({ params }: PageProps<"/dashboard/sales-orders/[id]/batches/[batchId]/edit">) {
  const { id, batchId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(batchId)) notFound();

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from("sales_order_batches")
    .select("id, batch_number, sales_order_id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch || batch.sales_order_id !== id) notFound();

  const form = await getDispatchForm(batch.sales_order_id, batch.id);
  if (!form) notFound();

  const batchHref = `/dashboard/sales-orders/${id}/batches/${batch.id}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link href={batchHref} className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
        <ArrowLeft className="size-4" /> Back to {batch.batch_number}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Edit {batch.batch_number}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {form.order.salesorder_number} · {form.order.customer_name ?? "—"} · Clear an item’s quantity to remove it from
          this batch.
        </p>
      </div>

      <BatchForm salesOrderId={batch.sales_order_id} batchId={batch.id} rows={form.rows} cancelHref={batchHref} />
    </div>
  );
}
