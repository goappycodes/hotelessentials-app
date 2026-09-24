// Helpers shared by the PDF route handlers (quote + dispatch).

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

export function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}
