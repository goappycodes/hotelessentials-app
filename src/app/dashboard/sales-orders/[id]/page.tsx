import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, PackagePlus, Truck } from "lucide-react";
import { ItemImage } from "@/components/item-image";
import { createClient } from "@/lib/supabase/server";
import { DispatchStatusBadge, formatQty, RemainingBadge } from "@/app/dashboard/sales-orders/_dispatch/dispatch-status";
import { formatDate, formatDateTime, formatMoney, StatusBadge } from "../format";

export const metadata: Metadata = { title: "Sales Order" };

type Address = Record<string, string> | null;

type SalesOrderItem = {
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

type SalesOrder = {
  id: string;
  salesorder_number: string;
  reference_number: string | null;
  date: string | null;
  shipment_date: string | null;
  status: string | null;
  invoiced_status: string | null;
  paid_status: string | null;
  shipped_status: string | null;
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
  sales_order_items: SalesOrderItem[];
};

export default async function SalesOrderPage({ params }: PageProps<"/dashboard/sales-orders/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: order }, { data: dispatch }, { data: batches }, { data: summary }] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("*, sales_order_items(*)")
      .eq("id", id)
      .order("item_order", { referencedTable: "sales_order_items", ascending: true })
      .maybeSingle<SalesOrder>(),
    supabase.from("sales_order_item_dispatch").select("sales_order_item_id, quantity_sent, remaining").eq("sales_order_id", id),
    supabase
      .from("sales_order_batch_summaries")
      .select("id, batch_number, item_count, total_quantity, box_count, created_at, created_by_email")
      .eq("sales_order_id", id)
      .order("batch_seq", { ascending: false }),
    supabase
      .from("sales_order_dispatch_summary")
      .select("dispatch_status, total_quantity, quantity_sent, pending_item_count")
      .eq("sales_order_id", id)
      .maybeSingle(),
  ]);

  if (!order) notFound();

  const dispatchByItem = new Map(
    (dispatch ?? []).map((d) => [d.sales_order_item_id, { sent: Number(d.quantity_sent), remaining: Number(d.remaining) }]),
  );

  const currency = order.currency_code ?? "INR";
  const money = (value: number | null) => formatMoney(value, currency);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link href="/dashboard/sales-orders" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900">
        <ArrowLeft className="size-4" /> Back to sales orders
      </Link>

      {/* Header */}
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{order.salesorder_number}</h1>
              <StatusBadge value={order.status} />
              <DispatchStatusBadge status={summary?.dispatch_status ?? null} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {order.customer_name ?? "—"}
              {order.reference_number && <> · Ref {order.reference_number}</>}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm text-slate-500">Total</p>
            <p className="text-2xl font-semibold text-slate-900">{money(order.total)}</p>
          </div>
        </div>

        <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Order date" value={formatDate(order.date)} />
          <Detail label="Expected shipment" value={formatDate(order.shipment_date)} />
          <Detail label="Salesperson" value={order.salesperson_name} />
          <Detail label="Payment terms" value={order.payment_terms_label} />
          <Detail label="Invoiced" value={<StatusBadge value={order.invoiced_status} />} />
          <Detail label="Payment" value={<StatusBadge value={order.paid_status} />} />
          <Detail label="Shipment" value={<StatusBadge value={order.shipped_status} />} />
          <Detail label="Last synced" value={formatDateTime(order.synced_at)} />
          <Detail
            label="Dispatch"
            value={
              summary?.dispatch_status ? (
                <span className="flex flex-wrap items-center gap-2">
                  <DispatchStatusBadge status={summary.dispatch_status} />
                  <span className="text-xs font-normal text-slate-500">
                    {formatQty(summary.quantity_sent)} / {formatQty(summary.total_quantity)} sent
                    {summary.pending_item_count > 0 &&
                      ` · ${summary.pending_item_count} item${summary.pending_item_count === 1 ? "" : "s"} pending`}
                  </span>
                </span>
              ) : null
            }
          />
        </dl>
      </section>

      {/* Items */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Items</h2>
            <p className="text-sm text-slate-500">
              {order.sales_order_items.length} line items · {order.total_quantity ?? 0} units
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/dashboard/sales-orders/${order.id}/export`}
              title="Download the items table as an Excel file"
              className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              <FileSpreadsheet className="size-4" /> Export Excel
            </a>
            <Link
              href={`/dashboard/sales-orders/${order.id}/dispatch`}
              className="flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800"
            >
              <Truck className="size-4" /> Dispatch items
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-y border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Item</th>
                <th className="px-5 py-3 font-medium">HSN/SAC</th>
                <th className="px-5 py-3 text-right font-medium">Qty</th>
                <th className="px-5 py-3 text-right font-medium">Sent</th>
                <th className="px-5 py-3 font-medium">Remaining</th>
                <th className="px-5 py-3 text-right font-medium">Rate</th>
                <th className="px-5 py-3 font-medium">Tax</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.sales_order_items.map((item, index) => (
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
                  <td className="whitespace-nowrap px-5 py-3 text-right text-slate-700 tabular-nums">
                    {formatQty(dispatchByItem.get(item.id)?.sent ?? 0)}
                  </td>
                  <td className="px-5 py-3">
                    <RemainingBadge value={dispatchByItem.get(item.id)?.remaining ?? -Number(item.quantity ?? 0)} />
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
            <Total label="Sub total" value={money(order.sub_total)} />
            {!!order.discount_total && <Total label="Discount" value={`− ${money(order.discount_total)}`} />}
            <Total label="Tax" value={money(order.tax_total)} />
            {!!order.shipping_charge && <Total label="Shipping" value={money(order.shipping_charge)} />}
            {!!order.adjustment && <Total label="Adjustment" value={money(order.adjustment)} />}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <dt>Total</dt>
              <dd>{money(order.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Batch history */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 p-5">
          <div>
            <h2 className="font-semibold text-slate-900">Dispatch batches</h2>
            <p className="text-sm text-slate-500">
              {batches?.length ? `${batches.length} batch${batches.length === 1 ? "" : "es"}` : "No items dispatched yet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!!batches?.length && (
              <Link
                href={`/dashboard/sales-orders/${order.id}/batches`}
                className="flex h-9 items-center rounded-xl px-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
              >
                View all
              </Link>
            )}
            <Link
              href={`/dashboard/sales-orders/${order.id}/dispatch`}
              className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <PackagePlus className="size-4" /> New batch
            </Link>
          </div>
        </div>
        {!!batches?.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[740px] text-left text-sm">
              <thead className="border-y border-slate-100 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Batch #</th>
                  <th className="px-5 py-3 text-right font-medium">Items</th>
                  <th className="px-5 py-3 text-right font-medium">Total qty</th>
                  <th className="px-5 py-3 text-right font-medium">Boxes</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 text-right font-medium">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <tr key={b.id} className="transition hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/sales-orders/${order.id}/batches/${b.id}`} className="font-medium text-brand-700 hover:underline">
                        {b.batch_number}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{b.item_count}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-900 tabular-nums">{formatQty(b.total_quantity)}</td>
                    <td className="px-5 py-3 text-right text-slate-600 tabular-nums">{b.box_count}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {formatDateTime(b.created_at)} <span className="text-xs text-slate-400">· {b.created_by_email ?? "—"}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <a
                        href={`/dashboard/sales-orders/${order.id}/batches/${b.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open dispatch PDF in a new tab"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                      >
                        <Download className="size-3.5" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Addresses & notes */}
      <section className="grid gap-4 md:grid-cols-2">
        <AddressCard title="Billing address" address={order.billing_address} />
        <AddressCard title="Shipping address" address={order.shipping_address} />
        {order.notes && <TextCard title="Customer notes" body={order.notes} />}
        {order.terms && <TextCard title="Terms & conditions" body={order.terms} />}
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
