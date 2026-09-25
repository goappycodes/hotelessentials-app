import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

// Helpers for the Zoho Books webhooks (Settings → Automation → Workflow Actions → Webhooks).

const ZOHO_ID = /^\d{5,25}$/;

/** The header the Zoho webhook sends its shared secret in (added under the webhook's HTTP Headers). */
const SECRET_HEADER = "x-zoho-webhook-secret";

/** How much of a rejected request's body is written to the logs. */
const BODY_PREVIEW_CHARS = 1500;

/** Constant-time comparison. Both values are hashed first so their lengths can't leak through timing. */
function secretsMatch(given: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// Reading the payload --------------------------------------------------------------------------------

type ParsedBody = { format: "json" | "form" | "empty" | "unrecognised"; root: unknown; error?: string };

/**
 * Parses a webhook body. The format is detected from the content itself (a JSON object/array, or key=value
 * form fields) rather than trusted from the Content-Type header, and a byte-order mark or surrounding
 * whitespace is ignored — Zoho's body templates don't always match the header they are sent with.
 */
function parseBody(rawBody: string): ParsedBody {
  const text = rawBody.replace(/^﻿/, "").trim();
  if (!text) return { format: "empty", root: null };

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return { format: "json", root: JSON.parse(text) };
    } catch (error) {
      return { format: "unrecognised", root: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (text.includes("=")) return { format: "form", root: Object.fromEntries(new URLSearchParams(text)) };
  return { format: "unrecognised", root: null };
}

/**
 * Breadth-first search for `key` anywhere in the parsed body (nested objects, arrays, or inside a `JSONString`
 * field), so the outermost match wins. `accept` lets the caller skip values that are present but unusable.
 */
function findValue(root: unknown, key: string, accept: (value: unknown) => boolean = () => true): unknown {
  const queue: [unknown, number][] = [[root, 0]];
  while (queue.length) {
    const [node, depth] = queue.shift()!;
    if (!node || typeof node !== "object" || depth > 6) continue;

    if (Object.hasOwn(node, key)) {
      const value = (node as Record<string, unknown>)[key];
      if (accept(value)) return value;
    }

    for (const [name, value] of Object.entries(node)) {
      if (name === "JSONString" && typeof value === "string") {
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
  return undefined;
}

const isZohoId = (value: unknown): value is string => typeof value === "string" && ZOHO_ID.test(value.trim());

/**
 * Finds a Zoho id (`idKey`, e.g. "quote_id" or "organization_id"): first in the request body (wherever it is
 * nested), then in the URL's query string, where Zoho puts webhook "custom parameters". Only string ids are
 * taken from parsed JSON, because Zoho ids can be 19 digits, which a JSON number cannot hold exactly; an
 * unquoted numeric id is instead read from the raw text so its digits are not rounded.
 */
export function extractZohoId(rawBody: string, idKey: string, query?: URLSearchParams): string | null {
  const fromBody = findValue(parseBody(rawBody).root, idKey, isZohoId);
  if (isZohoId(fromBody)) return fromBody.trim();

  const fromQuery = query?.get(idKey);
  if (isZohoId(fromQuery)) return fromQuery.trim();

  return new RegExp(`"${idKey}"\\s*:\\s*(\\d{5,25})\\b`).exec(rawBody)?.[1] ?? null;
}

/**
 * A safe-to-share description of what the request contained, for the logs and for error responses: which
 * keys were present and what the id fields held (they are ids, not secrets), but never the rest of the body.
 */
function describePayload(rawBody: string, contentType: string, query: URLSearchParams, idKeys: string[]) {
  const parsed = parseBody(rawBody);
  const root = parsed.root;

  const keys = Object.fromEntries(
    idKeys.map((key) => {
      const value = findValue(root, key) ?? query.get(key) ?? undefined;
      const info =
        value === undefined
          ? { found: false as const }
          : { found: true as const, type: typeof value, value: String(value).slice(0, 60), validId: isZohoId(value) };
      return [key, info];
    }),
  );

  return {
    contentType,
    bodyLength: rawBody.length,
    format: parsed.format,
    ...(parsed.error ? { parseError: parsed.error } : {}),
    topLevelKeys: root && typeof root === "object" ? Object.keys(root).slice(0, 40) : [],
    queryKeys: [...query.keys()],
    keys,
  };
}

// Handling the request -------------------------------------------------------------------------------

/** One JSON line per event, easy to search in the Vercel logs for "[zoho-webhook]". */
function log(event: string, data: Record<string, unknown> = {}) {
  console.log(`[zoho-webhook] ${JSON.stringify({ event, ...data })}`);
}

/**
 * The request handling shared by every Zoho webhook route. Zoho is not signed in to the app, so the request
 * is authenticated here: the `X-Zoho-Webhook-Secret` header must equal ZOHO_WEBHOOK_SECRET, and the payload's
 * `organization_id` must be this app's Zoho organization (ZOHO_BOOKS_ORG_ID). Then it reads the record id
 * (`idKey`), runs `run` (save or delete the record) and replies with JSON. Zoho waits 10 s and retries
 * anything that isn't a 2xx, so failures are returned as 4xx/5xx rather than swallowed.
 *
 * Logging: every request writes a `[zoho-webhook]` line with its outcome. A rejected payload also logs a
 * preview of the body, and its 400 response says what was found; set ZOHO_WEBHOOK_DEBUG=1 to log every
 * authenticated payload. The secret itself is never logged.
 */
export async function handleZohoWebhook(
  request: NextRequest,
  opts: { idKey: string; run: (id: string) => Promise<object>; revalidate: string },
): Promise<Response> {
  const startedAt = Date.now();
  const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

  const contentType = request.headers.get("content-type") ?? "";
  const query = request.nextUrl.searchParams;
  const meta = {
    route: request.nextUrl.pathname,
    method: request.method,
    contentType,
    contentLength: request.headers.get("content-length"),
    userAgent: request.headers.get("user-agent"),
    // Header names only (never values), minus the platform's own, to see what Zoho really sends.
    headers: [...request.headers.keys()].filter((name) => !/^(x-vercel|x-forwarded|x-real-ip)/.test(name)).sort(),
  };

  // Refuse everything until both values are configured, rather than running unauthenticated.
  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  const organizationId = process.env.ZOHO_BOOKS_ORG_ID;
  if (!secret || !organizationId) {
    console.error(
      `[zoho-webhook] not configured: ${[!secret && "ZOHO_WEBHOOK_SECRET", !organizationId && "ZOHO_BOOKS_ORG_ID"].filter(Boolean).join(", ")} is not set; rejecting the request.`,
    );
    return reply({ ok: false, error: "The webhook is not configured on the server." }, 500);
  }

  const given = request.headers.get(SECRET_HEADER);
  if (!given || !secretsMatch(given, secret)) {
    log("unauthorized", {
      ...meta,
      reason: given ? "the X-Zoho-Webhook-Secret value does not match ZOHO_WEBHOOK_SECRET" : "no X-Zoho-Webhook-Secret header",
      // Lengths only: a difference points at stray spaces/quotes, or at a different environment's secret.
      receivedLength: given?.length ?? null,
      expectedLength: secret.length,
    });
    return reply({ ok: false, error: "Invalid or missing X-Zoho-Webhook-Secret header." }, 401);
  }

  const rawBody = await request.text();
  const idKeys = [opts.idKey, "organization_id"];

  // Only authenticated callers get here, so the reply can safely say what was received.
  const reject = (error: string) => {
    const received = describePayload(rawBody, contentType, query, idKeys);
    log("rejected", {
      ...meta,
      status: 400,
      error,
      received,
      expectedOrganizationId: organizationId,
      bodyPreview: rawBody.slice(0, BODY_PREVIEW_CHARS).split(secret).join("[redacted]"),
    });
    return reply({ ok: false, error, received }, 400);
  };

  const id = extractZohoId(rawBody, opts.idKey, query);
  if (!id) return reject(`No valid ${opts.idKey} found in the payload.`);

  const payloadOrganizationId = extractZohoId(rawBody, "organization_id", query);
  if (!payloadOrganizationId) return reject("No valid organization_id found in the payload.");
  if (payloadOrganizationId !== organizationId) {
    return reject("The payload's organization_id does not match this app's Zoho organization.");
  }

  if (process.env.ZOHO_WEBHOOK_DEBUG) {
    log("received", { ...meta, received: describePayload(rawBody, contentType, query, idKeys), bodyPreview: rawBody.slice(0, BODY_PREVIEW_CHARS).split(secret).join("[redacted]") });
  }

  try {
    const result = await opts.run(id);
    revalidatePath(opts.revalidate, "layout");
    log("ok", { route: meta.route, method: meta.method, idKey: opts.idKey, id, result, ms: Date.now() - startedAt });
    return reply({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[zoho-webhook] ${JSON.stringify({ event: "failed", route: meta.route, idKey: opts.idKey, id, error: message, ms: Date.now() - startedAt })}`);
    return reply({ ok: false, error: message }, 500);
  }
}

/** Response for GET: open the webhook URL in a browser to check it is deployed and the secret is set. */
export function zohoWebhookHealth(name: string) {
  const configured = Boolean(process.env.ZOHO_WEBHOOK_SECRET && process.env.ZOHO_BOOKS_ORG_ID);
  return Response.json({ ok: true, webhook: name, method: "POST", configured });
}
