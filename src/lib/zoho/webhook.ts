import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

// Helpers for the Zoho Books webhooks (Settings → Automation → Workflow Actions → Webhooks).

const ZOHO_ID = /^\d{5,25}$/;

/** The header the Zoho webhook sends its shared secret in (added under the webhook's HTTP Headers). */
const SECRET_HEADER = "x-zoho-webhook-secret";

/** Constant-time comparison. Both values are hashed first so their lengths can't leak through timing. */
function secretsMatch(given: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Finds a Zoho id (`idKey`, e.g. "quote_id" or "organization_id") in a webhook body. It looks for the key at
 * the top level of the JSON — or nested under another key, inside a `JSONString` field, or as a form field —
 * so it does not depend on the exact body layout. Only string ids are trusted from the parsed JSON: Zoho ids
 * are 11–19 digits, which a JSON number cannot always hold exactly.
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
 * The request handling shared by every Zoho webhook route. Zoho is not signed in to the app, so the request
 * is authenticated here: the `X-Zoho-Webhook-Secret` header must equal ZOHO_WEBHOOK_SECRET, and the payload's
 * `organization_id` must be this app's Zoho organization (ZOHO_BOOKS_ORG_ID). Then it reads the record id
 * (`idKey`), runs `sync` and replies with JSON. Zoho waits 10 s and retries anything that isn't a 2xx, so
 * failures are returned as 4xx/5xx rather than swallowed.
 */
export async function handleZohoWebhook(
  request: NextRequest,
  opts: { idKey: string; sync: (id: string) => Promise<object>; revalidate: string },
): Promise<Response> {
  const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

  // Refuse everything until both values are configured, rather than running unauthenticated.
  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  const organizationId = process.env.ZOHO_BOOKS_ORG_ID;
  if (!secret || !organizationId) {
    console.error("[zoho-webhook] ZOHO_WEBHOOK_SECRET / ZOHO_BOOKS_ORG_ID is not set; rejecting the request.");
    return reply({ ok: false, error: "The webhook is not configured on the server." }, 500);
  }

  const given = request.headers.get(SECRET_HEADER);
  if (!given || !secretsMatch(given, secret)) {
    return reply({ ok: false, error: "Invalid or missing X-Zoho-Webhook-Secret header." }, 401);
  }

  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? "";

  const id = extractZohoId(rawBody, contentType, opts.idKey);
  if (!id) return reply({ ok: false, error: `No ${opts.idKey} found in the payload.` }, 400);

  const payloadOrganizationId = extractZohoId(rawBody, contentType, "organization_id");
  if (!payloadOrganizationId) return reply({ ok: false, error: "No organization_id found in the payload." }, 400);
  if (payloadOrganizationId !== organizationId) {
    return reply({ ok: false, error: "The payload's organization_id does not match this app's Zoho organization." }, 400);
  }

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
  const configured = Boolean(process.env.ZOHO_WEBHOOK_SECRET && process.env.ZOHO_BOOKS_ORG_ID);
  return Response.json({ ok: true, webhook: name, method: "POST", configured });
}
