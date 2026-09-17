export function formatMoney(amount: number | null, currency = "INR") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export const humanize = (value: string | null) =>
  value ? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

const statusTones: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-500/15",
  open: "bg-sky-50 text-sky-700 ring-sky-600/15",
  pending_approval: "bg-amber-50 text-amber-700 ring-amber-600/15",
  approved: "bg-sky-50 text-sky-700 ring-sky-600/15",
  partially_invoiced: "bg-violet-50 text-violet-700 ring-violet-600/15",
  invoiced: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  closed: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  unpaid: "bg-red-50 text-red-600 ring-red-600/15",
  partially_paid: "bg-amber-50 text-amber-700 ring-amber-600/15",
  pending: "bg-amber-50 text-amber-700 ring-amber-600/15",
  shipped: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  fulfilled: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  void: "bg-red-50 text-red-600 ring-red-600/15",
};

export function StatusBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        statusTones[value] ?? "bg-slate-100 text-slate-600 ring-slate-500/15"
      }`}
    >
      {humanize(value)}
    </span>
  );
}
