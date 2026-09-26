import "server-only";

// Zoho Books API client (server-only).
// Auth: long-lived refresh token → short-lived access token (cached in memory).
// Rate limit: Zoho Books allows ~100 requests/minute per organisation, so calls are
// spaced out and 429 responses are retried.

const MIN_INTERVAL_MS = 650; // ≈ 92 requests / minute
const MAX_RETRIES = 3;

/** A failed Zoho request. The HTTP status, Zoho's own error code and the API path are kept for the webhook logs. */
export class ZohoApiError extends Error {
  status: number;
  path: string;
  zohoCode?: number | string;

  constructor(message: string, details: { status: number; path: string; zohoCode?: number | string }) {
    super(message);
    this.name = "ZohoApiError";
    this.status = details.status;
    this.path = details.path;
    this.zohoCode = details.zohoCode;
  }
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const params = new URLSearchParams({
    refresh_token: env("ZOHO_REFRESH_TOKEN"),
    client_id: env("ZOHO_CLIENT_ID"),
    client_secret: env("ZOHO_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });

  const res = await fetch(`${env("ZOHO_ACCOUNTS_BASE_URL")}/oauth/v2/token`, {
    method: "POST",
    body: params,
    cache: "no-store",
  });
  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new ZohoApiError(`Zoho token refresh failed: ${data.error ?? res.statusText}`, {
      status: res.status,
      path: "/oauth/v2/token",
    });
  }

  // Refresh a minute early to avoid using a token that expires mid-request.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

let lastRequestAt = 0;

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

/** The only way the app talks to Zoho Books. It is read-only: every request is a GET, so Books data is never changed. */
async function zohoRequest(path: string, query: Record<string, string | number> = {}) {
  const url = new URL(`${env("ZOHO_API_BASE_URL")}/books/v3${path}`);
  url.searchParams.set("organization_id", env("ZOHO_BOOKS_ORG_ID"));
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

  let tokenRefreshed = false;

  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${await getAccessToken()}` },
      cache: "no-store",
    });

    if (res.status === 401 && !tokenRefreshed) {
      tokenRefreshed = true;
      await getAccessToken(true);
      continue;
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after")) || 60;
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    return res;
  }
}

async function zohoJson<T>(path: string, query?: Record<string, string | number>): Promise<T> {
  const res = await zohoRequest(path, query);
  const body = await res.text();

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    // An error page from Zoho or a proxy rather than the API's JSON.
    throw new ZohoApiError(`Zoho ${path} failed: HTTP ${res.status} ${res.statusText}, not JSON: ${body.slice(0, 200)}`, {
      status: res.status,
      path,
    });
  }

  if (!res.ok || data.code !== 0) {
    throw new ZohoApiError(`Zoho ${path} failed: ${data.message ?? res.statusText}`, {
      status: res.status,
      path,
      zohoCode: data.code,
    });
  }
  return data as T;
}

// Types (only the fields the app relies on; the full payload is stored as raw JSON) -------

export type ZohoSalesOrderSummary = {
  salesorder_id: string;
  salesorder_number: string;
  last_modified_time: string;
};

export type ZohoLineItem = {
  line_item_id: string;
  item_id: string;
  item_order: number;
  name: string;
  sku: string;
  description: string;
  unit: string;
  hsn_or_sac: string;
  product_type: string;
  quantity: number;
  quantity_invoiced: number;
  rate: number;
  discount: number | string;
  discount_amount: number;
  tax_id: string;
  tax_name: string;
  tax_percentage: number;
  item_sub_total: number;
  item_total: number;
  image_document_id: string;
  image_name: string;
  image_type: string;
  [key: string]: unknown;
};

export type ZohoSalesOrder = {
  salesorder_id: string;
  salesorder_number: string;
  reference_number: string;
  date: string;
  shipment_date: string;
  status: string;
  order_status: string;
  invoiced_status: string;
  paid_status: string;
  shipped_status: string;
  current_sub_status: string;
  customer_id: string;
  customer_name: string;
  salesperson_name: string;
  currency_code: string;
  currency_symbol: string;
  exchange_rate: number;
  sub_total: number;
  discount_total: number;
  tax_total: number;
  shipping_charge: number;
  adjustment: number;
  total: number;
  balance: number;
  total_quantity: number;
  place_of_supply: string;
  payment_terms_label: string;
  billing_address: Record<string, string>;
  shipping_address: Record<string, string>;
  notes: string;
  terms: string;
  custom_fields: unknown[];
  created_time: string;
  last_modified_time: string;
  line_items: ZohoLineItem[];
  [key: string]: unknown;
};

// Quotes (Zoho Books "estimates") -----------------------------------------------------

export type ZohoEstimateSummary = {
  estimate_id: string;
  estimate_number: string;
  last_modified_time: string;
};

export type ZohoEstimate = {
  estimate_id: string;
  estimate_number: string;
  reference_number: string;
  date: string;
  expiry_date: string;
  status: string;
  current_sub_status: string;
  customer_id: string;
  customer_name: string;
  salesperson_name: string;
  currency_code: string;
  currency_symbol: string;
  exchange_rate: number;
  sub_total: number;
  discount_total: number;
  tax_total: number;
  shipping_charge: number;
  adjustment: number;
  total: number;
  total_quantity: number;
  place_of_supply: string;
  payment_terms_label: string;
  billing_address: Record<string, string>;
  shipping_address: Record<string, string>;
  notes: string;
  terms: string;
  custom_fields: unknown[];
  created_time: string;
  last_modified_time: string;
  line_items: ZohoLineItem[];
  [key: string]: unknown;
};

// Endpoints ---------------------------------------------------------------------------

export async function listAllSalesOrders() {
  const orders: ZohoSalesOrderSummary[] = [];

  for (let page = 1; ; page++) {
    const data = await zohoJson<{
      salesorders: ZohoSalesOrderSummary[];
      page_context: { has_more_page: boolean };
    }>("/salesorders", { page, per_page: 200 });

    orders.push(...data.salesorders);
    if (!data.page_context?.has_more_page) return orders;
  }
}

export async function getSalesOrder(salesorderId: string) {
  const data = await zohoJson<{ salesorder: ZohoSalesOrder }>(`/salesorders/${salesorderId}`);
  return data.salesorder;
}

export async function listAllEstimates() {
  const estimates: ZohoEstimateSummary[] = [];

  for (let page = 1; ; page++) {
    const data = await zohoJson<{
      estimates: ZohoEstimateSummary[];
      page_context: { has_more_page: boolean };
    }>("/estimates", { page, per_page: 200 });

    estimates.push(...data.estimates);
    if (!data.page_context?.has_more_page) return estimates;
  }
}

export async function getEstimate(estimateId: string) {
  const data = await zohoJson<{ estimate: ZohoEstimate }>(`/estimates/${estimateId}`);
  return data.estimate;
}

// Contacts (customers) ----------------------------------------------------------

export type ZohoContact = {
  contact_id: string;
  billing_address?: Record<string, string>;
  shipping_address?: Record<string, string>;
  [key: string]: unknown;
};

export async function getContact(contactId: string) {
  const data = await zohoJson<{ contact: ZohoContact }>(`/contacts/${contactId}`);
  return data.contact;
}

/** Zoho Books image link for an item (requires a Zoho OAuth token to open). */
export function zohoItemImageUrl(itemId: string) {
  return `${env("ZOHO_API_BASE_URL")}/books/v3/items/${itemId}/image?organization_id=${env("ZOHO_BOOKS_ORG_ID")}`;
}

/** Fetches an item's image from Zoho. Returns null when the item has no image. */
export async function getItemImage(itemId: string) {
  const res = await zohoRequest(`/items/${itemId}/image`);
  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!contentType.startsWith("image/")) return null;

  return { body: await res.arrayBuffer(), contentType };
}
