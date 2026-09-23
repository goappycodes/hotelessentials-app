import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileText, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney, humanize, StatusBadge } from "../sales-orders/format";
import { SyncButton } from "./sync-button";

export const metadata: Metadata = { title: "Quotes" };

// A first full sync can take a few minutes because of Zoho's rate limits.
export const maxDuration = 300;

const PAGE_SIZE = 20;
const STATUSES = ["all", "draft", "sent", "invoiced", "accepted", "declined", "expired"];

type QuoteRow = {
  id: string;
  estimate_number: string;
  reference_number: string | null;
  date: string | null;
  expiry_date: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  status: string | null;
  currency_code: string | null;
  total: number | null;
  item_count: number;
  total_quantity: number;
};

export default async function QuotesPage({ searchParams }: PageProps<"/dashboard/quotes">) {
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim();
  const status = typeof params.status === "string" && STATUSES.includes(params.status) ? params.status : "all";
  const page = Math.max(1, Number(params.page) || 1);

  const { role } = await requireUser();
  const supabase = await createClient();

  let query = supabase
    .from("quote_list")
    .select(
      "id, estimate_number, reference_number, date, expiry_date, customer_name, salesperson_name, status, currency_code, total, item_count, total_quantity",
      { count: "exact" },
    )
    .order("date", { ascending: false })
    .order("estimate_number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status !== "all") query = query.eq("status", status);
  if (q) {
    // Strip characters that have meaning in PostgREST filter syntax.
    const term = q.replace(/[,()*%\\]/g, " ");
    query = query.or(
      `estimate_number.ilike.%${term}%,customer_name.ilike.%${term}%,reference_number.ilike.%${term}%`,
    );
  }

  const [{ data, count, error }, { data: lastRun }] = await Promise.all([
    query.returns<QuoteRow[]>(),
    supabase
      .from("zoho_sync_runs")
      .select("status, finished_at, started_at, error")
      .eq("resource", "quotes")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const quotes = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (overrides: Record<string, string | number>) => {
    const next = new URLSearchParams();
    const merged = { q, status, page, ...overrides };
    if (merged.q) next.set("q", String(merged.q));
    if (merged.status !== "all") next.set("status", String(merged.status));
    if (Number(merged.page) > 1) next.set("page", String(merged.page));
    const qs = next.toString();
    return `/dashboard/quotes${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Quotes</h1>
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
        {role === "admin" && <SyncButton />}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            Could not load quotes: <span className="font-mono">{error.message}</span>. Have you run the database
            migrations (<code className="font-mono">npm run db:push</code>)?
          </p>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Quote status" className="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
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

          <form action="/dashboard/quotes" className="relative w-full lg:w-80">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search quote #, customer, reference…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-500/15"
            />
          </form>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="whitespace-nowrap px-5 py-3 font-medium">Quote #</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Salesperson</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Expiry</th>
                <th className="px-5 py-3 text-right font-medium">Items</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 text-right font-medium">Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotes.map((quote) => (
                <tr key={quote.id} className="group transition hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-5 py-3.5 text-slate-500">{formatDate(quote.date)}</td>
                  <td className="px-5 py-3.5">
                    <Link href={`/dashboard/quotes/${quote.id}`} className="whitespace-nowrap font-medium text-brand-700 hover:underline">
                      {quote.estimate_number}
                    </Link>
                    {quote.reference_number && <p className="whitespace-nowrap text-xs text-slate-400">Ref: {quote.reference_number}</p>}
                  </td>
                  <td className="max-w-[240px] truncate px-5 py-3.5 font-medium text-slate-800" title={quote.customer_name ?? ""}>
                    {quote.customer_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">{quote.salesperson_name ?? "—"}</td>
                  <td className="px-5 py-3.5"><StatusBadge value={quote.status} /></td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-slate-500">{formatDate(quote.expiry_date)}</td>
                  <td className="px-5 py-3.5 text-right text-slate-600">{quote.item_count}</td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-right font-medium text-slate-900">
                    {formatMoney(quote.total, quote.currency_code ?? "INR")}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <a
                      href={`/dashboard/quotes/${quote.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open quote PDF in a new tab"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                    >
                      <Download className="size-3.5" /> PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!error && quotes.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <FileText className="size-6" />
              </span>
              <p className="font-medium text-slate-800">{q || status !== "all" ? "No matching quotes" : "No quotes yet"}</p>
              <p className="max-w-sm text-sm text-slate-500">
                {q || status !== "all"
                  ? "Try a different search or status filter."
                  : role === "admin"
                    ? "Click “Sync from Zoho” to import quotes from Zoho Books."
                    : "Ask an admin to sync quotes from Zoho Books."}
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
