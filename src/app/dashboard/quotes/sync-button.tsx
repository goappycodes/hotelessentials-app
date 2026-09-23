"use client";

import { useActionState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { syncQuotesFromZoho, type SyncState } from "./actions";

export function SyncButton() {
  const [state, action, isPending] = useActionState<SyncState>(syncQuotesFromZoho, {});

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <form action={action}>
        <button
          type="submit"
          disabled={isPending}
          className="flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <RefreshCw className={`size-4 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "Syncing from Zoho…" : "Sync from Zoho"}
        </button>
      </form>
      {!isPending && state.message && (
        <p className={`flex items-center gap-1.5 text-xs ${state.ok ? "text-emerald-700" : "text-red-600"}`}>
          {state.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
          {state.message}
        </p>
      )}
    </div>
  );
}
