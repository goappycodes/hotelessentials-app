"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { syncSalesOrders } from "@/lib/zoho/sync";

export type SyncState = { ok?: boolean; message?: string };

export async function syncFromZoho(): Promise<SyncState> {
  const { user, role } = await requireUser();
  if (role !== "admin") return { ok: false, message: "Only admins can sync from Zoho." };

  try {
    const { fetched, updated, deleted } = await syncSalesOrders({ triggeredBy: user.id });
    revalidatePath("/dashboard/sales-orders", "layout");
    return {
      ok: true,
      message: `Synced ${fetched} orders · ${updated} updated${deleted ? ` · ${deleted} removed` : ""}.`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
