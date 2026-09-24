import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DispatchStatusBadge } from "./_dispatch/dispatch-status";
import { ExportRemainingButton } from "./export-remaining-button";
import { formatDate, formatDateTime, formatMoney, humanize, StatusBadge } from "./format";
import { SyncButton } from "./sync-button";

export const metadata: Metadata = { title: "Sales Orders" };

// A first full sync can take a few minutes because of Zoho's rate limits.
export const maxDuration = 300;

const PAGE_SIZE = 20;
const STATUSES = ["all", "draft", "open", "partially_invoiced", "invoiced", "void"];
const DISPATCH = ["all", "pending", "fulfilled"];

type SalesOrderRow = {
  id: string;
  salesorder_number: string;
  reference_number: string | null;
  date: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  status: string | null;
  invoiced_status: string | null;
  shipped_status: string | null;
  currency_code: string | null;
  total: number | null;
  item_count: number;
  total_quantity: number;
  quantity_sent: number;
  dispatch_status: "pending" | "fulfilled" | null;
};

export default async function SalesOrdersPage({ searchParams }: PageProps<"/dashboard/sales-orders">) {
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim();
  const status = typeof params.status === "string" && STATUSES.includes(params.status) ? params.status : "all";
  const dispatch = typeof params.dispatch === "string" && DISPATCH.includes(params.dispatch) ? params.dispatch : "all";
  const page = Math.max(1, Number(params.page) || 1);

  const { role } = await requireUser();
  const supabase = await createClient();

  let query = supabase
    .from("sales_order_list")
    .select(
      "id, salesorder_number, reference_number, date, customer_name, salesperson_name, status, invoiced_status, shipped_status, currency_code, total, item_count, total_quantity, quantity_sent, dispatch_status",
      { count: "exact" },
    )
    .order("date", { ascending: false })
    .order("salesorder_number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status !== "all") query = query.eq("status", status);
  if (dispatch !== "all") query = query.eq("dispatch_status", dispatch);
  if (q) {
    // Strip characters that have meaning in PostgREST filter syntax.
    const term = q.replace(/[,()*%\\]/g, " ");
    query = query.or(
      `salesorder_number.ilike.%${term}%,customer_name.ilike.%${term}%,reference_number.ilike.%${term}%`,
    );
  }

  const [{ data, count, error }, { data: lastRun }] = await Promise.all([
    query.returns<SalesOrderRow[]>(),
    supabase
      .from("zoho_sync_runs")
      .select("status, finished_at, started_at, error")
      .eq("resource", "sales_orders")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const orders = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (overrides: Record<string, string | number>) => {
    const next = new URLSearchParams();
    const merged = { q, status, dispatch, page, ...overrides };
    if (merged.q) next.set("q", String(merged.q));
    if (merged.status !== "all") next.set("status", String(merged.status));
    if (merged.dispatch !== "all") next.set("dispatch", String(merged.dispatch));
    if (Number(merged.page) > 1) next.set("page", String(merged.page));
    const qs = next.toString();
    return `/dashboard/sales-orders${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sales Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Synced from Zoho Books
            {lastRun && (
              <>
                {" · "}
                {lastRun.status === "running"
                  ? "sync in progress…"
                  : `last sync ${formatDateTime(lastRun.finished_at ?? lastRun.started_at)}`}
                {lastRun.status === "failed" && <span className="text-red-600"> (failed)</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:flex-row">
          <ExportRemainingButton />
          {role === "admin" && <SyncButton />}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Could not load sales orders: <span className="font-mono">{error.message}</span>. Have you run the database
            migrations (<code className="font-mono">npm run db:push</code>)?
          </p>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
          <nav aria-label="Zoho status" className="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
            <span className="mr-1 w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">Zoho</span>
            {STATUSES.map((s) => (
              <Link
                key={s}
                href={href({ status: s, page: 1 })}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  status === s ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {s === "all" ? "All" : humanize(s)}
              </Link>
            ))}
          </nav>
          <nav aria-label="Dispatch status" className="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
            <span className="mr-1 w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">Dispatch</span>
            {DISPATCH.map((d) => (
              <Link
                key={d}
                href={href({ dispatch: d, page: 1 })}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  dispatch === d ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {humanize(d)}
              </Link>
            ))}
          </nav>
          </div>

          <form action="/dashboard/sales-orders" className="relative w-full lg:w-80">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            {dispatch !== "all" && <input type="hidden" name="dispatch" value={dispatch} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search order #, customer, reference…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15"
            />
          </form>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="whitespace-nowrap px-5 py-3 font-medium">Sales order #</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Salesperson</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Invoiced</th>
                <th className="px-5 py-3 font-medium">Shipped</th>
                <th className="px-5 py-3 font-medium">Dispatch</th>
                <th className="px-5 py-3 text-right font-medium">Items</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="group transition hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-5 py-3.5 text-slate-500">{formatDate(o.date)}</td>
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/sales-orders/${o.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline">
                      {o.salesorder_number}
                    </Link>
                    {o.reference_number && <p className="whitespace-nowrap text-xs text-slate-400">Ref: {o.reference_number}</p>}
                  </td>
                  <td className="max-w-[240px] truncate px-5 py-3.5 font-medium text-slate-800" title={o.customer_name ?? ""}>
                    {o.customer_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{o.salesperson_name ?? "—"}</td>
                  <td className="px-5 py-3.5"><StatusBadge value={o.status} /></td>
                  <td className="px-5 py-3.5"><StatusBadge value={o.invoiced_status} /></td>
                  <td className="px-5 py-3.5"><StatusBadge value={o.shipped_status} /></td>
                  <td className="px-5 py-3.5">
                    <DispatchStatusBadge status={o.dispatch_status} sent={Number(o.quantity_sent)} total={Number(o.total_quantity)} />
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600">{o.item_count}</td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-right font-medium text-slate-900">
                    {formatMoney(o.total, o.currency_code ?? "INR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!error && orders.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <ClipboardList className="size-6" />
              </span>
              <p className="font-medium text-slate-800">{q || status !== "all" || dispatch !== "all" ? "No matching sales orders" : "No sales orders yet"}</p>
              <p className="max-w-sm text-sm text-slate-500">
                {q || status !== "all"
                  ? "Try a different search or status filter."
                  : role === "admin"
                    ? "Click “Sync from Zoho” to import sales orders from Zoho Books."
                    : "Ask an admin to sync sales orders from Zoho Books."}
              </p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            <p>
              Showing <span className="font-medium text-slate-700">{(page - 1) * PAGE_SIZE + 1}</span>–
              <span className="font-medium text-slate-700">{Math.min(page * PAGE_SIZE, total)}</span> of{" "}
              <span className="font-medium text-slate-700">{total}</span>
            </p>
            <div className="flex items-center gap-2">
              <PageLink href={href({ page: page - 1 })} disabled={page <= 1} label="Previous page">
                <ChevronLeft className="size-4" />
              </PageLink>
              <span>
                Page {page} of {totalPages}
              </span>
              <PageLink href={href({ page: page + 1 })} disabled={page >= totalPages} label="Next page">
                <ChevronRight className="size-4" />
              </PageLink>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  const className = "grid size-8 place-items-center rounded-lg border border-slate-200 transition";
  return disabled ? (
    <span aria-disabled className={`${className} cursor-not-allowed text-slate-300`}>{children}</span>
  ) : (
    <Link href={href} aria-label={label} className={`${className} text-slate-600 hover:bg-slate-50`}>
      {children}
    </Link>
  );
}
