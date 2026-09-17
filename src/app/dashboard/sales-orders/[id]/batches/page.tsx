import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PackageOpen, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DispatchStatusBadge, formatQty } from "@/app/dashboard/sales-orders/_dispatch/dispatch-status";
import { formatDateTime } from "../../format";

export const metadata: Metadata = { title: "Dispatch Batches" };

type BatchSummary = {
  id: string;
  batch_number: string;
  item_count: number;
  total_quantity: number;
  box_count: number;
  created_at: string;
  created_by_email: string | null;
  updated_at: string;
  updated_by_email: string | null;
};

export default async function SalesOrderBatchesPage({ params }: PageProps<"/dashboard/sales-orders/[id]/batches">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: order }, { data: summary }, { data: batches, error }] = await Promise.all([
    supabase.from("sales_orders").select("id, salesorder_number, customer_name").eq("id", id).maybeSingle(),
    supabase
      .from("sales_order_dispatch_summary")
      .select("dispatch_status, total_quantity, quantity_sent, pending_item_count, item_count")
      .eq("sales_order_id", id)
      .maybeSingle(),
    supabase
      .from("sales_order_batch_summaries")
      .select("id, batch_number, item_count, total_quantity, box_count, created_at, created_by_email, updated_at, updated_by_email")
      .eq("sales_order_id", id)
      .order("batch_seq", { ascending: false })
      .returns<BatchSummary[]>(),
  ]);

  if (!order) notFound();

  const orderHref = `/dashboard/sales-orders/${id}`;
  const list = batches ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link href={orderHref} className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
        <ArrowLeft className="size-4" /> Back to {order.salesorder_number}
      </Link>

      {/* Header */}
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Dispatch batches</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                <Link href={orderHref} className="hover:underline">
                  {order.salesorder_number}
                </Link>
              </h1>
              <DispatchStatusBadge status={summary?.dispatch_status ?? null} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{order.customer_name ?? "—"}</p>
          </div>
          <Link
            href={`${orderHref}/dispatch`}
            className="flex h-10 items-center gap-2 self-start rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800"
          >
            <PackagePlus className="size-4" /> New batch
          </Link>
        </div>

        {summary && (
          <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Batches" value={list.length} />
            <Stat label="Quantity sent" value={`${formatQty(summary.quantity_sent)} / ${formatQty(summary.total_quantity)}`} />
            <Stat label="Items fully sent" value={`${summary.item_count - summary.pending_item_count} / ${summary.item_count}`} />
            <Stat label="Items pending" value={summary.pending_item_count} />
          </dl>
        )}
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load batches: {error.message}</div>
      )}

      {/* Batches */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Batch #</th>
                <th className="px-5 py-3 text-right font-medium">Items</th>
                <th className="px-5 py-3 text-right font-medium">Total qty</th>
                <th className="px-5 py-3 text-right font-medium">Boxes</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium">Last edited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((b) => (
                <tr key={b.id} className="transition hover:bg-slate-50/70">
                  <td className="px-5 py-3.5">
                    <Link href={`${orderHref}/batches/${b.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline">
                      {b.batch_number}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600 tabular-nums">{b.item_count}</td>
                  <td className="px-5 py-3.5 text-right font-medium text-slate-900 tabular-nums">{formatQty(b.total_quantity)}</td>
                  <td className="px-5 py-3.5 text-right text-slate-600 tabular-nums">{b.box_count}</td>
                  <td className="px-5 py-3.5">
                    <p className="whitespace-nowrap text-slate-600">{formatDateTime(b.created_at)}</p>
                    <p className="text-xs text-slate-400">{b.created_by_email ?? "—"}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    {b.updated_by_email ? (
                      <>
                        <p className="whitespace-nowrap text-slate-600">{formatDateTime(b.updated_at)}</p>
                        <p className="text-xs text-slate-400">{b.updated_by_email}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!error && list.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <PackageOpen className="size-6" />
              </span>
              <p className="font-medium text-slate-800">No dispatch batches yet</p>
              <p className="max-w-sm text-sm text-slate-500">Click “New batch” to record the first dispatch for this order.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium text-slate-800">{value}</dd>
    </div>
  );
}
