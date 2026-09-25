// Helpers shared by the PDF route handlers (quote + dispatch).
import { getItemImage } from "@/lib/zoho/client";
import type { PdfImage } from "./shared";

type CustomFields = Array<{ label?: string; value?: unknown }> | null;

// Zoho stores the customer's GST/PAN in different places across editions; look in the
// most common ones (top-level fields on the record, then custom fields).
export function pickField(raw: Record<string, unknown> | null, custom: CustomFields, keys: string[], labelMatch: RegExp) {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const field of custom ?? []) {
    if (field.label && labelMatch.test(field.label) && typeof field.value === "string" && field.value.trim()) {
      return field.value.trim();
    }
  }
  return null;
}

function imageFormat(contentType: string): PdfImage["format"] | null {
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg" || contentType === "image/jpg") return "jpg";
  return null;
}

/**
 * Fetches an item's picture from Zoho (read-only) for embedding in a PDF. Returns null when the
 * item has no picture or the fetch fails, so the document still renders without it.
 */
export async function fetchItemImage(zohoItemId: string | null, imageDocumentId: string | null): Promise<PdfImage | null> {
  if (!zohoItemId || !imageDocumentId || !/^\d+$/.test(zohoItemId)) return null;
  try {
    const fetched = await getItemImage(zohoItemId);
    const format = fetched && imageFormat(fetched.contentType);
    if (fetched && format) return { data: Buffer.from(fetched.body), format };
  } catch {
    // Ignore image failures — the PDF still renders without the picture.
  }
  return null;
}

export function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}
