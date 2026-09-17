"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";
import { deleteBatch } from "./actions";

export function DeleteBatchButton({ batchId, salesOrderId, batchNumber }: { batchId: string; salesOrderId: string; batchNumber: string }) {
  return (
    <form
      action={deleteBatch}
      onSubmit={(event) => {
        if (!confirm(`Delete ${batchNumber}? Its sent quantities will be removed from the sales order.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="batch_id" value={batchId} />
      <input type="hidden" name="sales_order_id" value={salesOrderId} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      Delete
    </button>
  );
}
