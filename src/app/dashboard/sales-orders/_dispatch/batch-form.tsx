"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { AlertCircle, Loader2, PackageCheck, Search } from "lucide-react";
import { ItemImage } from "@/components/item-image";
import { saveBatch, type BatchFormState } from "./actions";
import type { DispatchRow } from "./data";
import { formatQty, RemainingBadge } from "./dispatch-status";

type Props = {
  salesOrderId: string;
  batchId?: string;
  rows: DispatchRow[];
  cancelHref: string;
};

export function BatchForm({ salesOrderId, batchId, rows: initialRows, cancelHref }: Props) {
  const [state, formAction, isPending] = useActionState<BatchFormState, FormData>(saveBatch, {});
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const update = (id: string, patch: Partial<Pick<DispatchRow, "box" | "quantity">>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const qtyOf = (row: DispatchRow) => {
    const n = Number(row.quantity);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const sending = rows.filter((row) => qtyOf(row) > 0);
  const totalQty = sending.reduce((sum, row) => sum + qtyOf(row), 0);
  const missingBox = sending.filter((row) => !row.box.trim());

  const visibleRows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(term) || row.sku?.toLowerCase().includes(term));
  }, [rows, filter]);

  const payload = JSON.stringify(sending.map(({ id, box, quantity }) => ({ id, box, quantity })));

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (sending.length === 0 || missingBox.length > 0) {
          event.preventDefault();
          setShowErrors(true);
        }
      }}
      className="space-y-4"
    >
      <input type="hidden" name="sales_order_id" value={salesOrderId} />
      {batchId && <input type="hidden" name="batch_id" value={batchId} />}
      <input type="hidden" name="items" value={payload} />

      {(state.error || (showErrors && (sending.length === 0 || missingBox.length > 0))) && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error ??
            (sending.length === 0
              ? "Enter a sent quantity for at least one item."
              : `Add box info for ${missingBox.length} item${missingBox.length > 1 ? "s" : ""} being sent.`)}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            Enter box info and the quantity being sent now. Leave quantity empty for items not in this batch.
          </p>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter items…"
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 text-right font-medium">Original qty</th>
                <th className="px-4 py-3 text-right font-medium">Already sent</th>
                <th className="w-64 px-4 py-3 font-medium">Box</th>
                <th className="w-40 px-4 py-3 font-medium">Sent qty</th>
                <th className="px-4 py-3 font-medium">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((row, index) => {
                const qty = qtyOf(row);
                const remaining = row.sentElsewhere + qty - row.originalQuantity;
                const outstanding = Math.max(row.originalQuantity - row.sentElsewhere, 0);
                const boxError = showErrors && qty > 0 && !row.box.trim();

                return (
                  <tr key={row.id} className={qty > 0 ? "bg-brand-50/40" : "transition hover:bg-slate-50/60"}>
                    <td className="px-4 py-3 text-slate-400">{row.itemOrder ?? index + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ItemImage
                          zohoItemId={row.zohoItemId}
                          imageUrl={row.imageUrl}
                          imageDocumentId={row.imageDocumentId}
                          alt={row.name}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">{row.name}</p>
                          {row.sku && <p className="font-mono text-xs text-slate-400">{row.sku}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700 tabular-nums">
                      {formatQty(row.originalQuantity)} {row.unit}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-500 tabular-nums">
                      {formatQty(row.sentElsewhere)}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={row.box}
                        maxLength={200}
                        onChange={(e) => update(row.id, { box: e.target.value })}
                        placeholder="e.g. Box 1"
                        aria-label={`Box for ${row.name}`}
                        aria-invalid={boxError}
                        className={`h-9 w-full rounded-lg border bg-white px-3 text-sm outline-none transition placeholder:text-slate-300 focus:ring-4 ${
                          boxError
                            ? "border-red-300 focus:border-red-400 focus:ring-red-500/15"
                            : "border-slate-200 focus:border-brand-500 focus:ring-brand-500/15"
                        }`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={row.quantity}
                          onChange={(e) => update(row.id, { quantity: e.target.value })}
                          placeholder="0"
                          aria-label={`Sent quantity for ${row.name}`}
                          className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2.5 text-right text-sm tabular-nums outline-none transition placeholder:text-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
                        />
                        {outstanding > 0 && qty !== outstanding && (
                          <button
                            type="button"
                            onClick={() => update(row.id, { quantity: String(outstanding) })}
                            title={`Send all ${formatQty(outstanding)} remaining`}
                            className="rounded-md px-1.5 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50"
                          >
                            All
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RemainingBadge value={remaining} />
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    No items match “{filter}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sticky action bar */}
      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-lg backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <PackageCheck className="size-4 text-brand-600" />
          <span>
            <span className="font-semibold text-slate-900">{sending.length}</span> item{sending.length === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold text-slate-900">{formatQty(totalQty)}</span> qty in this batch
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            href={cancelHref}
            className="flex h-10 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            {isPending ? "Saving…" : batchId ? "Save changes" : "Save batch"}
          </button>
        </div>
      </div>
    </form>
  );
}
