import "server-only";

// Logging for the Zoho webhooks: one JSON object per line, starting "[zoho-webhook]", so it is easy to find in
// Vercel → Logs (search "[zoho-webhook]"; set Level to Error to see only the requests that went wrong).

const MAX_STACK_FRAMES = 6;
const MAX_CAUSE_STACK_FRAMES = 2;
const MAX_CAUSES = 4;
const MAX_FIELD_CHARS = 500;

/** "error" (console.error) for anything that ends in a non-2xx reply or a swallowed failure; "info" for the rest. */
export function webhookLog(level: "info" | "error", event: string, data: Record<string, unknown> = {}) {
  const line = `[zoho-webhook] ${JSON.stringify({ event, ...data })}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

/**
 * Everything worth knowing about a thrown value, as plain JSON: name, message, the top of the app's stack, any simple
 * fields it carries (a Supabase error's code / details / hint, a Zoho error's status / path) and its `cause`
 * chain (e.g. the network error behind "fetch failed"). Accepts non-Error values too.
 */
export function describeError(error: unknown, depth = 0): Record<string, unknown> {
  if (error === null || typeof error !== "object") return { message: String(error) };

  const fields = error as Record<string, unknown>;
  const described: Record<string, unknown> = {
    name: typeof fields.name === "string" ? fields.name : error.constructor?.name,
    message: typeof fields.message === "string" ? fields.message : safeJson(error),
  };

  for (const [key, value] of Object.entries(fields)) {
    if (key in described || key === "stack" || key === "cause") continue;
    if (typeof value === "string") described[key] = value.slice(0, MAX_FIELD_CHARS);
    else if (typeof value === "number" || typeof value === "boolean") described[key] = value;
  }

  if (typeof fields.stack === "string") {
    described.stack = fields.stack
      .split("\n")
      .map((line) => line.trim())
      // Only the app's own frames: Node and framework internals repeat in every error and bury the useful lines.
      .filter((line) => line.startsWith("at ") && !line.includes("node_modules") && !line.includes("node:"))
      .slice(0, depth === 0 ? MAX_STACK_FRAMES : MAX_CAUSE_STACK_FRAMES);
  }

  if (fields.cause !== undefined && depth < MAX_CAUSES) described.cause = describeError(fields.cause, depth + 1);
  return described;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, MAX_FIELD_CHARS);
  } catch {
    return String(value);
  }
}
