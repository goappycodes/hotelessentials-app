// Seeder: default admin user.
// Uses the service role key (Auth Admin API over HTTPS) — no database password needed.
// Idempotent: re-running keeps a single admin and resets its password to ADMIN_SEED_PASSWORD.
//
//   npm run db:seed
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const {
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  ADMIN_SEED_EMAIL: email = "admin@hotelessentials.com",
  ADMIN_SEED_PASSWORD: password,
} = process.env;

if (!url || !serviceKey || !password) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or ADMIN_SEED_PASSWORD in .env.local (see .env.example).");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const admin = {
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Admin User" },
  app_metadata: { role: "admin" },
};

async function findUserByEmail(target) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target.toLowerCase());
    if (match || data.users.length < 1000) return match ?? null;
  }
}

async function seedAdmin() {
  const existing = await findUserByEmail(email);

  const { data, error } = existing
    ? await supabase.auth.admin.updateUserById(existing.id, admin)
    : await supabase.auth.admin.createUser(admin);
  if (error) throw error;

  console.log(`✔ Admin user ${existing ? "updated" : "created"}: ${email}`);

  // Profile row: created by the migration's trigger/backfill. Promote it if the table exists.
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: data.user.id, email, full_name: admin.user_metadata.full_name, role: "admin" });

  if (profileError) {
    console.warn(`! Skipped profile (${profileError.message}).`);
    console.warn("  Run the migration (npm run db:push); it backfills the admin profile automatically.");
  } else {
    console.log("✔ Admin profile set to role=admin");
  }
}

seedAdmin().catch((err) => {
  console.error("✘ Seeding failed:", err.message ?? err);
  process.exit(1);
});
