import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Box, Pencil } from "lucide-react";
import { ItemImage } from "@/components/item-image";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/app/dashboard/sales-orders/format";
import { DeleteBatchButton } from "@/app/dashboard/sales-orders/_dispatch/delete-batch-button";
import { formatQty, RemainingBadge } from "@/app/dashboard/sales-orders/_dispatch/dispatch-status";

export const metadata: Metadata = { title: "Batch" };

type BatchItem = {
  id: string;
  box_label: string;
  quantity_sent: number;
  item_name: string;
  item_sku: string | null;
  original_quantity: number | null;
  sales_order_item_id: string | null;
  sales_order_items: {
    zoho_item_id: string | null;
    image_url: string | null;
    image_document_id: string | null;
    unit: string | null;
    item_order: number | null;
  } | null;
};

export default async function BatchPage({ params }: PageProps<"/dashboard/sales-orders/[id]/batches/[batchId]">) {
  const { id, batchId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(batchId)) notFound();

  const supabase = await createClient();
  const [{ data: batch }, { data: items }] = await Promise.all([
    supabase.from("sales_order_batch_summaries").select("*").eq("id", batchId).maybeSingle(),
    supabase
      .from("sales_order_batch_items")
      .select(
        "id, box_label, quantity_sent, item_name, item_sku, original_quantity, sales_order_item_id, sales_order_items(zoho_item_id, image_url, image_document_id, unit, item_order)",
      )
      .eq("batch_id", batchId)
      .returns<BatchItem[]>(),
  ]);

  if (!batch || batch.sales_order_id !== id) notFound();

  const itemIds = (items ?? []).map((i) => i.sales_order_item_id).filter((id): id is string => Boolean(id));
  const { data: totals } = itemIds.length
    ? await supabase.from("sales_order_item_dispatch").select("sales_order_item_id, remaining").in("sales_order_item_id", itemIds)
    : { data: [] };
  const remainingByItem = new Map((totals ?? []).map((t) => [t.sales_order_item_id, Number(t.remaining)]));

  // Group by box label (natural sort so "Box 2" comes before "Box 10").
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const groups = new Map<string, BatchItem[]>();
  for (const item of [...(items ?? [])].sort(
    (a, b) => (a.sales_order_items?.item_order ?? 0) - (b.sales_order_items?.item_order ?? 0),
  )) {
    groups.set(item.box_label, [...(groups.get(item.box_label) ?? []), item]);
  }
  const boxes = [...groups.entries()].sort(([a], [b]) => collator.compare(a, b));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link href={`/dashboard/sales-orders/${id}/batches`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
        <ArrowLeft className="size-4" /> Back to {batch.salesorder_number} batches
      </Link>

      {/* Header */}
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{batch.batch_number}</h1>
            <p className="mt-1 text-sm text-slate-500">
              <Link href={`/dashboard/sales-orders/${batch.sales_order_id}`} className="font-medium text-brand-700 hover:underline">
                {batch.salesorder_number}
              </Link>{" "}
              · {batch.customer_name ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/sales-orders/${id}/batches/${batch.id}/edit`}
              className="flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800"
            >
              <Pencil className="size-4" /> Edit
            </Link>
            <DeleteBatchButton batchId={batch.id} salesOrderId={batch.sales_order_id} batchNumber={batch.batch_number} />
          </div>
        </div>

        <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Items" value={batch.item_count} />
          <Stat label="Total qty sent" value={formatQty(batch.total_quantity)} />
          <Stat label="Boxes" value={batch.box_count} />
          <Stat label="Created" value={`${formatDateTime(batch.created_at)} · ${batch.created_by_email ?? "—"}`} />
          <Stat
            label="Last edited"
            value={batch.updated_by_email ? `${formatDateTime(batch.updated_at)} · ${batch.updated_by_email}` : "—"}
          />
        </dl>
      </section>

      {/* Items grouped by box */}
      {boxes.map(([box, boxItems]) => (
        <section key={box} className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900">
              <Box className="size-4 text-brand-600" /> {box}
            </h2>
            <p className="text-sm text-slate-500">
              {boxItems.length} item{boxItems.length === 1 ? "" : "s"} ·{" "}
              {formatQty(boxItems.reduce((sum, i) => sum + Number(i.quantity_sent), 0))} qty
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Item</th>
                  <th className="px-5 py-3 text-right font-medium">Original qty</th>
                  <th className="px-5 py-3 text-right font-medium">Sent in this batch</th>
                  <th className="px-5 py-3 font-medium">Remaining (all batches)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {boxItems.map((item) => {
                  const remaining = item.sales_order_item_id ? remainingByItem.get(item.sales_order_item_id) : undefined;
                  return (
                    <tr key={item.id} className="transition hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <ItemImage
                            zohoItemId={item.sales_order_items?.zoho_item_id ?? null}
                            imageUrl={item.sales_order_items?.image_url ?? null}
                            imageDocumentId={item.sales_order_items?.image_document_id ?? null}
                            alt={item.item_name}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800">{item.item_name}</p>
                            {item.item_sku && <p className="font-mono text-xs text-slate-400">{item.item_sku}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-slate-600 tabular-nums">
                        {formatQty(item.original_quantity)} {item.sales_order_items?.unit}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-slate-900 tabular-nums">
                        {formatQty(item.quantity_sent)}
                      </td>
                      <td className="px-5 py-3">
                        {remaining === undefined ? (
                          <span className="text-xs text-slate-400">Item removed in Zoho</span>
                        ) : (
                          <RemainingBadge value={remaining} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
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
