"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { syncQuotes } from "@/lib/zoho/sync";

export type SyncState = { ok?: boolean; message?: string };

export async function syncQuotesFromZoho(): Promise<SyncState> {
  const { user, role } = await requireUser();
  if (role !== "admin") return { ok: false, message: "Only admins can sync from Zoho." };

  try {
    const { fetched, updated, deleted } = await syncQuotes({ triggeredBy: user.id });
    revalidatePath("/dashboard/quotes", "layout");
    return {
      ok: true,
      message: `Synced ${fetched} quotes · ${updated} updated${deleted ? ` · ${deleted} removed` : ""}.`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
