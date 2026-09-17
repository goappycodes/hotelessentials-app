// Runs Supabase CLI database commands against the remote project using
// credentials from .env.local — no `supabase login` / `supabase link` needed.
//
//   node scripts/db.mjs push            apply pending migrations
//   node scripts/db.mjs status          list local vs remote migrations
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_DB_PASSWORD, SUPABASE_POOLER_HOST } = process.env;
const projectRef = NEXT_PUBLIC_SUPABASE_URL && new URL(NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

if (!projectRef || !SUPABASE_DB_PASSWORD || !SUPABASE_POOLER_HOST) {
  console.error("Add SUPABASE_DB_PASSWORD and SUPABASE_POOLER_HOST to .env.local (see .env.example).");
  process.exit(1);
}

// Session pooler (IPv4). The direct db.<ref>.supabase.co host is IPv6-only.
const dbUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(SUPABASE_DB_PASSWORD)}@${SUPABASE_POOLER_HOST}:5432/postgres`;

const commands = {
  push: ["db", "push", "--db-url", dbUrl, "--yes"],
  status: ["migration", "list", "--db-url", dbUrl],
};

const [command, ...rest] = process.argv.slice(2);
const args = commands[command];

if (!args) {
  console.error(`Usage: node scripts/db.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}

// Invoke the CLI entry directly (no shell) so special characters in the URL stay intact.
const cli = require.resolve("supabase/dist/supabase.js");
const result = spawnSync(process.execPath, [cli, ...args, ...rest], { stdio: "inherit" });
process.exit(result.status ?? 1);
