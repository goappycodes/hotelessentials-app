import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { ItemImage } from "@/components/item-image";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney, StatusBadge } from "../../sales-orders/format";

export const metadata: Metadata = { title: "Quote" };

type Address = Record<string, string> | null;

type QuoteItem = {
  id: string;
  zoho_item_id: string | null;
  item_order: number | null;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string | null;
  hsn_or_sac: string | null;
  quantity: number | null;
  rate: number | null;
  discount: number | null;
  tax_name: string | null;
  item_total: number | null;
  image_document_id: string | null;
  image_name: string | null;
  image_url: string | null;
};

type Quote = {
  id: string;
  estimate_number: string;
  reference_number: string | null;
  date: string | null;
  expiry_date: string | null;
  status: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  currency_code: string | null;
  sub_total: number | null;
  discount_total: number | null;
  tax_total: number | null;
  shipping_charge: number | null;
  adjustment: number | null;
  total: number | null;
  total_quantity: number | null;
  place_of_supply: string | null;
  payment_terms_label: string | null;
  billing_address: Address;
  shipping_address: Address;
  notes: string | null;
  terms: string | null;
  synced_at: string;
  quote_items: QuoteItem[];
};

export default async function QuotePage({ params }: PageProps<"/dashboard/quotes/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select("*, quote_items(*)")
    .eq("id", id)
    .order("item_order", { referencedTable: "quote_items", ascending: true })
    .maybeSingle<Quote>();

  if (!quote) notFound();

  const currency = quote.currency_code ?? "INR";
  const money = (value: number | null) => formatMoney(value, currency);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link href="/dashboard/quotes" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
        <ArrowLeft className="size-4" /> Back to quotes
      </Link>

      {/* Header */}
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{quote.estimate_number}</h1>
              <StatusBadge value={quote.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {quote.customer_name ?? "—"}
              {quote.reference_number && <> · Ref {quote.reference_number}</>}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <div className="text-left sm:text-right">
              <p className="text-sm text-slate-500">Total</p>
              <p className="text-2xl font-semibold text-slate-900">{money(quote.total)}</p>
            </div>
            <a
              href={`/dashboard/quotes/${quote.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800"
            >
              <Download className="size-4" /> Download invoice
            </a>
          </div>
        </div>

        <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Quote date" value={formatDate(quote.date)} />
          <Detail label="Expiry date" value={formatDate(quote.expiry_date)} />
          <Detail label="Salesperson" value={quote.salesperson_name} />
          <Detail label="Payment terms" value={quote.payment_terms_label} />
          <Detail label="Place of supply" value={quote.place_of_supply} />
          <Detail label="Last synced" value={formatDateTime(quote.synced_at)} />
        </dl>
      </section>

      {/* Items */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <div className="p-5">
          <h2 className="font-semibold text-slate-900">Items</h2>
          <p className="text-sm text-slate-500">
            {quote.quote_items.length} line items · {quote.total_quantity ?? 0} units
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-y border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium">HSN/SAC</th>
                <th className="px-5 py-3 text-right font-medium">Qty</th>
                <th className="px-5 py-3 text-right font-medium">Rate</th>
                <th className="px-5 py-3 font-medium">Tax</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quote.quote_items.map((item, index) => (
                <tr key={item.id} className="transition hover:bg-slate-50/60">
                  <td className="px-5 py-3 text-slate-400">{item.item_order ?? index + 1}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ItemImage
                        zohoItemId={item.zoho_item_id}
                        imageUrl={item.image_url}
                        imageDocumentId={item.image_document_id}
                        alt={item.image_name ?? item.name}
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">{item.name}</p>
                        {item.sku && <p className="font-mono text-xs text-slate-400">{item.sku}</p>}
                        {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{item.hsn_or_sac ?? "—"}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right text-slate-700">
                    {item.quantity ?? 0} {item.unit}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right text-slate-700">{money(item.rate)}</td>
                  <td className="px-5 py-3 text-slate-500">{item.tax_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-slate-900">{money(item.item_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end border-t border-slate-100 p-5">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <Total label="Sub total" value={money(quote.sub_total)} />
            {!!quote.discount_total && <Total label="Discount" value={`− ${money(quote.discount_total)}`} />}
            <Total label="Tax" value={money(quote.tax_total)} />
            {!!quote.shipping_charge && <Total label="Shipping" value={money(quote.shipping_charge)} />}
            {!!quote.adjustment && <Total label="Adjustment" value={money(quote.adjustment)} />}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <dt>Total</dt>
              <dd>{money(quote.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Addresses & notes */}
      <section className="grid gap-4 md:grid-cols-2">
        <AddressCard title="Billing address" address={quote.billing_address} />
        <AddressCard title="Shipping address" address={quote.shipping_address} />
        {quote.notes && <TextCard title="Customer notes" body={quote.notes} />}
        {quote.terms && <TextCard title="Terms & conditions" body={quote.terms} />}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium text-slate-800">{value || "—"}</dd>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <dt>{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

function AddressCard({ title, address }: { title: string; address: Address }) {
  const lines = address
    ? [
        address.attention,
        address.address,
        address.street2,
        [address.city, address.state, address.zip].filter(Boolean).join(", "),
        address.country,
        address.phone,
      ].filter(Boolean)
    : [];

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {lines.length ? (
        <address className="mt-2 space-y-0.5 text-sm not-italic text-slate-600">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </address>
      ) : (
        <p className="mt-2 text-sm text-slate-400">Not provided</p>
      )}
    </div>
  );
}

function TextCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{body}</p>
    </div>
  );
}
