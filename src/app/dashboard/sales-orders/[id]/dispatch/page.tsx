import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BatchForm } from "@/app/dashboard/sales-orders/_dispatch/batch-form";
import { getDispatchForm } from "@/app/dashboard/sales-orders/_dispatch/data";

export const metadata: Metadata = { title: "Dispatch Items" };

export default async function DispatchPage({ params }: PageProps<"/dashboard/sales-orders/[id]/dispatch">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const form = await getDispatchForm(id);
  if (!form) notFound();

  const orderHref = `/dashboard/sales-orders/${id}/batches`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link href={orderHref} className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
        <ArrowLeft className="size-4" /> Back to {form.order.salesorder_number} batches
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New dispatch batch</h1>
        <p className="mt-1 text-sm text-slate-500">
          {form.order.salesorder_number} · {form.order.customer_name ?? "—"}
        </p>
      </div>

      <BatchForm salesOrderId={id} rows={form.rows} cancelHref={orderHref} />
    </div>
  );
}
