import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { describeError, webhookLog } from "./webhook-log";

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

type ParsedBody = { format: "json" | "multipart" | "form" | "empty" | "unrecognised"; root: unknown; error?: string };

/**
 * The text fields of a multipart/form-data body (what Zoho sends for a webhook's "Form Data" body). The boundary is
 * read from the body's first line, so the Content-Type header isn't needed. File parts are skipped. Returns null
 * when the text isn't multipart or has no fields.
 */
function parseMultipart(text: string): Record<string, string> | null {
  const boundary = /^--([^\r\n]+)/.exec(text)?.[1];
  if (!boundary) return null;

  const fields: Record<string, string> = {};
  for (const part of text.split(`--${boundary}`)) {
    const headerEnd = /\r?\n\r?\n/.exec(part); // the headers end at the first blank line
    if (!headerEnd) continue; // the text before the first boundary, or the closing "--"

    const headers = part.slice(0, headerEnd.index);
    const name = /content-disposition:[^\r\n]*?\bname="([^"]*)"/i.exec(headers)?.[1];
    if (name === undefined || /\bfilename=/i.test(headers)) continue;

    fields[name] = part.slice(headerEnd.index + headerEnd[0].length).replace(/\r?\n$/, "");
  }
  return Object.keys(fields).length ? fields : null;
}

/**
 * Parses a webhook body. The format is detected from the content itself (a JSON object/array, multipart form
 * data, or key=value form fields) rather than trusted from the Content-Type header, and a byte-order mark or
 * surrounding whitespace is ignored — Zoho's body templates don't always match the header they are sent with.
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

  const multipart = text.startsWith("--") ? parseMultipart(text) : null;
  if (multipart) return { format: "multipart", root: multipart };

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

/** An environment value as intended: without surrounding whitespace or a pair of quotes pasted along with it. */
const cleanEnv = (value: string | undefined) => value?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/** Which deployment answered (Vercel's commit and branch), so a response shows whether the latest code is live. */
function buildInfo() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  return branch ? `${commit} (${branch})` : commit;
}

/** Header values must be short printable ASCII. */
const headerSafe = (text: string) => text.replace(/[^\x20-\x7E]/g, "?").slice(0, 300);

type WebhookOptions = { idKey: string; run: (id: string) => Promise<object>; revalidate: string };

/** The Vercel request id, to match a log line to the request in Vercel's dashboard. */
const requestId = (request: NextRequest) => request.headers.get("x-vercel-id");

/**
 * The request handling shared by every Zoho webhook route. Zoho is not signed in to the app, so the request
 * is authenticated here: the `X-Zoho-Webhook-Secret` header must equal ZOHO_WEBHOOK_SECRET, and the payload's
 * `organization_id` must be this app's Zoho organization (ZOHO_BOOKS_ORG_ID). Then it reads the record id
 * (`idKey`), runs `run` (save or delete the record) and replies with JSON. Zoho waits 10 s and retries
 * anything that isn't a 2xx, so failures are returned as 4xx/5xx rather than swallowed.
 *
 * Diagnostics: every request writes `[zoho-webhook]` lines (see webhook-log.ts). Each failure — a refused secret, a
 * rejected payload, an error while saving, or an unexpected crash — is logged with console.error, including the
 * error's stack, its Supabase / Zoho details and its cause chain, plus the Vercel request id. A `processing` line
 * with no `ok` / `failed` after it means the function was cut off (timeout). A rejected payload also logs a
 * preview of the body, and its 400 response says what was found; set ZOHO_WEBHOOK_DEBUG=1 to log every
 * authenticated payload. Every response carries an `X-Webhook-Build` header (which commit answered) and, once the
 * caller has authenticated, an error carries `X-Webhook-Error` — Zoho's Workflow Logs show response headers even
 * when they don't show the body. The secret itself is never logged or returned.
 */
export async function handleZohoWebhook(request: NextRequest, opts: WebhookOptions): Promise<Response> {
  try {
    return await processWebhook(request, opts);
  } catch (error) {
    // Anything the steps below didn't anticipate; the details stay in the logs, not in the reply.
    webhookLog("error", "unexpected_error", {
      route: request.nextUrl.pathname,
      method: request.method,
      idKey: opts.idKey,
      requestId: requestId(request),
      error: describeError(error),
    });
    return Response.json(
      { ok: false, error: "Unexpected error while handling the webhook." },
      { status: 500, headers: { "X-Webhook-Build": headerSafe(buildInfo()) } },
    );
  }
}

async function processWebhook(request: NextRequest, opts: WebhookOptions): Promise<Response> {
  const startedAt = Date.now();
  const reply = (body: Record<string, unknown>, status = 200, errorHeader?: string) =>
    Response.json(body, {
      status,
      headers: { "X-Webhook-Build": headerSafe(buildInfo()), ...(errorHeader ? { "X-Webhook-Error": headerSafe(errorHeader) } : {}) },
    });

  const contentType = request.headers.get("content-type") ?? "";
  const query = request.nextUrl.searchParams;
  const meta = {
    route: request.nextUrl.pathname,
    method: request.method,
    requestId: requestId(request),
    contentType,
    contentLength: request.headers.get("content-length"),
    userAgent: request.headers.get("user-agent"),
    // Header names only (never values), minus the platform's own, to see what Zoho really sends.
    headers: [...request.headers.keys()].filter((name) => !/^(x-vercel|x-forwarded|x-real-ip)/.test(name)).sort(),
  };

  // Refuse everything until both values are configured, rather than running unauthenticated.
  const secret = cleanEnv(process.env.ZOHO_WEBHOOK_SECRET);
  const organizationId = cleanEnv(process.env.ZOHO_BOOKS_ORG_ID);
  if (!secret || !organizationId) {
    webhookLog("error", "not_configured", {
      ...meta,
      status: 500,
      missing: [!secret && "ZOHO_WEBHOOK_SECRET", !organizationId && "ZOHO_BOOKS_ORG_ID"].filter(Boolean),
    });
    return reply({ ok: false, error: "The webhook is not configured on the server." }, 500);
  }

  const given = request.headers.get(SECRET_HEADER);
  if (!given || !secretsMatch(given, secret)) {
    webhookLog("error", "unauthorized", {
      ...meta,
      status: 401,
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
    webhookLog("error", "rejected", {
      ...meta,
      status: 400,
      error,
      received,
      expectedOrganizationId: organizationId,
      bodyPreview: rawBody.slice(0, BODY_PREVIEW_CHARS).split(secret).join("[redacted]"),
    });

    // The same facts in one header line, for tools (like Zoho's Workflow Logs) that only show headers.
    const describeKey = (key: string) => {
      const info = received.keys[key];
      return info.found ? `${key}=${info.value}${info.validId ? "" : " (not a valid id)"}` : `${key}=missing`;
    };
    const summary = [
      `format=${received.format}`,
      `body keys=${received.topLevelKeys.join(",") || "none"}`,
      ...idKeys.map(describeKey),
      `server organization ends ${organizationId.slice(-4)} (${organizationId.length} chars)`,
      `content-type=${contentType || "none"}`,
      `body ${received.bodyLength} chars`,
    ].join("; ");
    return reply({ ok: false, error, received }, 400, `${error} ${summary}`);
  };

  const id = extractZohoId(rawBody, opts.idKey, query);
  if (!id) return reject(`No valid ${opts.idKey} found in the payload.`);

  const payloadOrganizationId = extractZohoId(rawBody, "organization_id", query);
  if (!payloadOrganizationId) return reject("No valid organization_id found in the payload.");
  if (payloadOrganizationId !== organizationId) {
    return reject("The payload's organization_id does not match this app's Zoho organization.");
  }

  if (process.env.ZOHO_WEBHOOK_DEBUG) {
    webhookLog("info", "received", { ...meta, received: describePayload(rawBody, contentType, query, idKeys), bodyPreview: rawBody.slice(0, BODY_PREVIEW_CHARS).split(secret).join("[redacted]") });
  }

  // Logged before the work starts: a `processing` line with no `ok` / `failed` after it means the function was cut off.
  const where = { route: meta.route, method: meta.method, idKey: opts.idKey, id, requestId: meta.requestId };
  webhookLog("info", "processing", where);

  let stage = "saving the record";
  try {
    const result = await opts.run(id);
    stage = "refreshing the page cache";
    revalidatePath(opts.revalidate, "layout");
    webhookLog("info", "ok", { ...where, result, ms: Date.now() - startedAt });
    return reply({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    webhookLog("error", "failed", { ...where, status: 500, stage, error: describeError(error), ms: Date.now() - startedAt });
    return reply({ ok: false, error: message }, 500, message);
  }
}

/** Response for GET: open the webhook URL in a browser to check it is deployed, configured, and which commit is live. */
export function zohoWebhookHealth(name: string) {
  const configured = Boolean(cleanEnv(process.env.ZOHO_WEBHOOK_SECRET) && cleanEnv(process.env.ZOHO_BOOKS_ORG_ID));
  return Response.json({ ok: true, webhook: name, method: "POST", configured, build: buildInfo() });
}
