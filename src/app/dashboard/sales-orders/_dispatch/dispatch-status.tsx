export function formatQty(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value ?? 0);
}

/** Remaining = total sent − original quantity: < 0 pending · 0 complete · > 0 over-sent. */
export function RemainingBadge({ value }: { value: number }) {
  const [tone, label] =
    value < 0
      ? ["bg-amber-50 text-amber-700 ring-amber-600/20", "Pending"]
      : value === 0
        ? ["bg-emerald-50 text-emerald-700 ring-emerald-600/20", "Complete"]
        : ["bg-red-50 text-red-600 ring-red-600/20", "Over-sent"];

  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      <span className="font-semibold tabular-nums">
        {value > 0 ? "+" : value < 0 ? "−" : ""}
        {formatQty(Math.abs(value))}
      </span>
      {label}
    </span>
  );
}

/** Order-level dispatch status: pending until every item is fully sent, then fulfilled. */
export function DispatchStatusBadge({
  status,
  sent,
  total,
}: {
  status: "pending" | "fulfilled" | null;
  sent?: number;
  total?: number;
}) {
  if (!status) return <span className="text-slate-400">—</span>;

  const fulfilled = status === "fulfilled";
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
          fulfilled ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20"
        }`}
      >
        <span className={`size-1.5 rounded-full ${fulfilled ? "bg-emerald-500" : "bg-amber-500"}`} />
        {fulfilled ? "Fulfilled" : "Pending"}
      </span>
      {total !== undefined && (
        <span className="whitespace-nowrap text-[11px] text-slate-400 tabular-nums">
          {formatQty(sent)} / {formatQty(total)} sent
        </span>
      )}
    </span>
  );
}
