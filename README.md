# Hotel Essentials App

Next.js 16 (App Router) + Supabase portal with email/password login and a dashboard.

## Stack
- Next.js 16, React 19, Tailwind CSS 4, lucide-react
- Supabase Auth via `@supabase/ssr` (cookie sessions, refreshed in `src/proxy.ts`)
- Supabase CLI for migrations and seeders (`supabase/`)

## Setup

```bash
npm install
cp .env.example .env.local   # already created with project keys
```

### Database (migrations + seeder)
All schema changes live in `supabase/migrations`; never create tables from the dashboard.
`db:seed` uses `SUPABASE_SERVICE_ROLE_KEY`. Migrations additionally need the database password — uncomment the migration block from `.env.example` in `.env.local` while running them.

| Command | What it does | Needs |
| --- | --- | --- |
| `npm run db:push` | Apply pending migrations | `SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST` |
| `npm run db:status` | Compare local vs remote migrations | same as above |
| `npm run db:seed` | Create/refresh the admin user (Auth Admin API) | `SUPABASE_SERVICE_ROLE_KEY` |
| `npm run db:migration:new <name>` | Create a new migration file | – |

Migrations and seeding are independent: the profiles migration backfills profiles for existing users,
taking `role` from the user's `app_metadata` (the seeder sets `role: "admin"`).

### Default admin (seeder `scripts/seed.mjs`)
| Email | Password |
| --- | --- |
| admin@hotelessentials.com | Admin@12345 |

The seeder reads `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` from `.env.local`; re-running it resets the admin password to that value. Change it before going live.

## Zoho Books sync
Sales orders and their line items are imported from Zoho Books into `sales_orders` and `sales_order_items`
(full Zoho payload kept in `raw`). Each run is logged in `zoho_sync_runs`.

- **Manual:** Dashboard → Sales Orders → **Sync from Zoho** (admins only).
- Only orders whose `last_modified_time` changed are re-fetched; orders deleted in Zoho are removed locally.
- Requests are throttled to stay under Zoho's ~100 requests/minute limit, so the first sync takes about a minute per ~90 orders.
- **Images stay in Zoho.** `image_url` stores the Zoho image link, which needs an OAuth token, so the UI loads
  images through `/api/zoho/items/[itemId]/image` (signed-in users only, browser-cached for a day).

## Dispatch batches (internal, not synced to Zoho)
Sales orders are dispatched in batches. Tables: `sales_order_batches` (batch #, e.g. `SO-00045-B1`) and
`sales_order_batch_items` (SO + item reference, free-text box info, quantity sent, snapshot of item name/SKU/qty).

- **Create:** Sales order → **Dispatch items** → enter box info + sent quantity per item → **Save batch**.
- **List / view / edit / delete:** Sales order → **Dispatch batches** (batches are always scoped to their sales order). Any signed-in user can manage batches.
- **Dispatch status** per order (shown on the order list, with a filter, and on the order page): `pending` until every item's remaining ≥ 0, then `fulfilled`. Derived by the `sales_order_dispatch_summary` view; the list reads the `sales_order_list` view.
- **Remaining** = total sent across batches − original quantity: `< 0` pending · `0` complete · `> 0` over-sent (allowed).
- Saving goes through the `save_sales_order_batch` database function, so a batch and its items are saved atomically.
- Totals come from the `sales_order_item_dispatch` and `sales_order_batch_summaries` views (never stored, so they can't drift).

## Deploy to Vercel
Set these environment variables in Vercel (Project → Settings → Environment Variables):

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy service_role key — server-only; mark as **Sensitive** |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` | Zoho OAuth — mark as **Sensitive** |
| `ZOHO_BOOKS_ORG_ID`, `ZOHO_ACCOUNTS_BASE_URL`, `ZOHO_API_BASE_URL` | Zoho Books organisation / data centre (.in) |

Never give the service role key a `NEXT_PUBLIC_` prefix. In Supabase → Authentication → URL Configuration,
set **Site URL** to your Vercel domain.

## Run
```bash
npm run dev
```
Open http://localhost:3000 → redirected to `/login` → `/dashboard` after sign-in.

## Structure
```
src/
  proxy.ts                  # session refresh + route protection
  app/actions.ts            # login / logout server actions
  app/login/                # login page + form
  app/dashboard/            # layout (sidebar, topbar) + dashboard page
  app/dashboard/sales-orders/  # list, detail ([id]), sync action
    [id]/dispatch/          # new dispatch batch form
    [id]/batches/           # the order's batches, batch detail ([batchId]) and edit
    _dispatch/              # shared batch form, actions, data loader, status badges
  app/api/zoho/             # item image route
  lib/zoho/                 # Zoho Books API client + sync logic
  lib/supabase/             # browser, server, proxy clients + env (URL + anon key)
  lib/auth.ts               # requireUser(): user + profile
scripts/
  db.mjs                    # migration runner (uses DB password from .env.local)
  seed.mjs                  # admin seeder (uses service role key)
supabase/
  migrations/               # schema (profiles, sales orders, sync runs, dispatch batches)
```
