import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

// Helpers for Zoho Books webhooks (Settings → Automation → Workflow Actions → Webhooks).

const ZOHO_ID = /^\d{5,25}$/;

type Pairs = Record<string, string>;

/** Zoho's signed string: the key/value pairs sorted by key and joined as key+value, with no separators. */
const concatSorted = (pairs: Pairs) =>
  Object.keys(pairs)
    .sort()
    .map((key) => key + pairs[key])
    .join("");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The body's own key/value pairs: form fields, or the top-level scalar values of a JSON object. */
function bodyPairs(rawBody: string, contentType: string): Pairs | null {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody));
  }
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const scalars = Object.entries(parsed).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v));
    return Object.fromEntries(scalars.map(([k, v]) => [k, String(v)]));
  } catch {
    return null;
  }
}

/**
 * Verifies the X-Zoho-Webhook-Signature header: base64(HMAC-SHA256(secret, signed string)).
 * Zoho's docs describe the signed string as the query-string parameters sorted by key and joined as
 * key+value, followed by the raw JSON body for JSON payloads. For form-encoded (and flat JSON)
 * payloads the body's own key/value pairs are sorted in with the query parameters instead — Zoho's
 * sample code does that — so both constructions are accepted; either one requires the secret.
 */
export function verifyZohoSignature(args: {
  secret: string;
  signature: string;
  rawBody: string;
  contentType: string;
  query: URLSearchParams;
}) {
  const query: Pairs = Object.fromEntries(args.query);
  const candidates = [concatSorted(query) + args.rawBody];

  const body = bodyPairs(args.rawBody, args.contentType);
  if (body) candidates.push(concatSorted({ ...query, ...body }));

  const given = args.signature.trim();
  return candidates.some((signed) => safeEqual(createHmac("sha256", args.secret).update(signed).digest("base64"), given));
}

/**
 * Finds a record id (`idKey`, e.g. "estimate_id" or "salesorder_id") in a webhook body. Zoho's docs don't
 * show a sample body for the "Default payload", so this looks for the key anywhere in the JSON (top level,
 * under an `estimate` / `salesorder` key, inside a `JSONString` field, …) or in form fields. Only string
 * ids are trusted from the parsed JSON: Zoho ids are 19 digits, which a JSON number cannot hold exactly.
 */
export function extractZohoId(rawBody: string, contentType: string, idKey: string): string | null {
  let root: unknown;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    root = Object.fromEntries(new URLSearchParams(rawBody));
  } else {
    try {
      root = JSON.parse(rawBody);
    } catch {
      return null;
    }
  }

  // Breadth-first, so the outermost id wins over any nested one.
  const queue: [unknown, number][] = [[root, 0]];
  while (queue.length) {
    const [node, depth] = queue.shift()!;
    if (!node || typeof node !== "object" || depth > 6) continue;

    const id = (node as Record<string, unknown>)[idKey];
    if (typeof id === "string" && ZOHO_ID.test(id)) return id;

    for (const [key, value] of Object.entries(node)) {
      if (key === "JSONString" && typeof value === "string") {
        try {
          queue.push([JSON.parse(value), depth + 1]);
        } catch {
          // Not JSON — ignore this field.
        }
      } else if (value && typeof value === "object") {
        queue.push([value, depth + 1]);
      }
    }
  }

  // Last resort: an unquoted numeric id, read from the raw text so its digits are not rounded.
  return new RegExp(`"${idKey}"\\s*:\\s*(\\d{5,25})\\b`).exec(rawBody)?.[1] ?? null;
}

/**
 * The request handling shared by every Zoho webhook route: refuse unless the secret is configured and the
 * signature is valid, find the record id, run `sync`, and reply with JSON. It authenticates the request
 * itself because Zoho is not signed in to the app. Zoho waits 10 s and retries anything that isn't a 2xx,
 * so failures are returned as 4xx/5xx rather than swallowed.
 */
export async function handleZohoWebhook(
  request: NextRequest,
  opts: { idKey: string; sync: (id: string) => Promise<object>; revalidate: string },
): Promise<Response> {
  const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[zoho-webhook] ZOHO_WEBHOOK_SECRET is not set; rejecting the request.");
    return reply({ ok: false, error: "The webhook is not configured on the server." }, 500);
  }

  // The signature covers the exact bytes Zoho sent, so read the body as raw text before parsing anything.
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? "";
  const signature = request.headers.get("x-zoho-webhook-signature");

  if (!signature || !verifyZohoSignature({ secret, signature, rawBody, contentType, query: request.nextUrl.searchParams })) {
    return reply({ ok: false, error: "Invalid or missing signature." }, 401);
  }

  const id = extractZohoId(rawBody, contentType, opts.idKey);
  if (!id) return reply({ ok: false, error: `No ${opts.idKey} found in the payload.` }, 400);

  try {
    const result = await opts.sync(id);
    revalidatePath(opts.revalidate, "layout");
    return reply({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[zoho-webhook] ${opts.idKey} ${id} failed:`, message);
    return reply({ ok: false, error: message }, 500);
  }
}

/** Response for GET: open the webhook URL in a browser to check it is deployed and the secret is set. */
export function zohoWebhookHealth(name: string) {
  return Response.json({ ok: true, webhook: name, method: "POST", configured: Boolean(process.env.ZOHO_WEBHOOK_SECRET) });
}
