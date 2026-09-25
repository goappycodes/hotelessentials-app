"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2, X } from "lucide-react";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Opens a popup to pick an order-date range, then downloads the remaining items of those sales orders as Excel. */
export function ExportRemainingButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    if (!busy) dialogRef.current?.close();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (from > to) {
      setError("The start date must be on or before the end date.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/dashboard/sales-orders/export?${new URLSearchParams({ from, to })}`);

      if (!res.ok) {
        // The route explains problems in plain text; anything else (e.g. an error page) gets a generic message.
        const message = (res.headers.get("content-type") ?? "").startsWith("text/plain") ? await res.text() : "";
        setError(message || "The export failed. Please try again.");
        return;
      }
      if (!(res.headers.get("content-type") ?? "").startsWith(XLSX_TYPE)) {
        // An expired session redirects to the sign-in page, which arrives here as a normal HTML response.
        setError("Your session may have expired. Reload the page and sign in again.");
        return;
      }

      const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "Remaining items.xlsx";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      dialogRef.current?.close();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100";

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
      >
        <FileSpreadsheet className="size-4" /> Export remaining items
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="export-remaining-title"
        onClick={(event) => {
          // A click on the backdrop lands on the <dialog> element itself.
          if (event.target === dialogRef.current) close();
        }}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
      >
        <form onSubmit={onSubmit}>
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="export-remaining-title" className="text-lg font-semibold text-slate-900">
                  Export remaining items
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Downloads an Excel file with the items still to be sent, one sheet per sales order dated in this range.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="-mr-2 -mt-1 grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                From
                <input
                  type="date"
                  required
                  value={from}
                  max={to || undefined}
                  onChange={(event) => setFrom(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                To
                <input
                  type="date"
                  required
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:px-6">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              {busy ? "Preparing…" : "Download"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
