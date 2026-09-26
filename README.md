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

## Zoho webhooks (Zoho → app, automatic)
Zoho Books can push changes to the app so the local copies stay current without clicking **Sync from Zoho**:

| Zoho module | Event | Endpoint | Effect on the app | Record id in the payload |
| --- | --- | --- | --- | --- |
| Quotes | created / edited | `POST /api/zoho/webhooks/quotes` | creates or updates `quotes` / `quote_items` | `quote_id` |
| Quotes | deleted | `POST /api/zoho/webhooks/quotes/delete` | deletes the quote and its items | `quote_id` |
| Sales Orders | created / edited | `POST /api/zoho/webhooks/sales-orders` | creates or updates `sales_orders` / `sales_order_items` | `sales_order_id` |
| Sales Orders | deleted | `POST /api/zoho/webhooks/sales-orders/delete` | deletes the order, its items **and its dispatch batches** | `sales_order_id` |

All payloads also carry `organization_id`. The delete endpoints also accept the HTTP method `DELETE`.

- **Authentication:** every request must send the header `X-Zoho-Webhook-Secret` with the value of `ZOHO_WEBHOOK_SECRET`
  (otherwise `401`), and the payload's `organization_id` must equal `ZOHO_BOOKS_ORG_ID` (otherwise `400`). Until both
  variables are set, every request is refused (`500`).
- **Create or update:** the record is **created** if it is new and **updated** (with its line items) if it exists, using the
  same save code as the Sync buttons (`saveQuote` / `saveSalesOrder` in `lib/zoho/sync.ts`). Redelivery is harmless
  (idempotent). Sales order line items keep their local ids on update, so dispatch batches stay linked. Each event is
  logged in `zoho_sync_runs` (resource `quotes` / `sales_orders`).
- **Delete:** removes the local record only, and makes **no request to Zoho**. A sales order's dispatch batches are
  deleted with it (the database cascades), exactly as when the Sync button removes an order that no longer exists in Zoho.
  Deleting a record that is already gone returns `200` with `"action":"not_found"`, so a retried delivery still succeeds.
- **Read-only towards Zoho:** the app never changes Zoho Books data. Its only requests to Zoho are `GET`s (plus the OAuth
  token refresh), and only for create/update; deletes make none.
- Open an endpoint in a browser to check it is deployed: it returns `{"ok":true,"configured":true,…}`.
- **Where the ids can be:** in the body (JSON, `multipart/form-data` fields — what Zoho sends for a webhook's *Form Data* body —
  or url-encoded form fields, at any depth; the format is detected from the content, not the `Content-Type` header, which Zoho
  does not always set to match) or as URL query parameters.

**Debugging a failing webhook.** Every request writes one JSON line starting `[zoho-webhook]` (Vercel → Logs → search for
that; set **Level = Error** to see only failures): `not_configured` (a `500`: the env vars missing), `unauthorized` (a `401`:
secret header missing/different — lengths only, never the value), `rejected` (a `400`: what was found, the payload's vs the
expected `organization_id`, and a body preview), `failed` (a `500` while saving — see below), `unexpected_error` (a crash
anywhere else in the handler), `processing` and `ok`. Every line has the route, the record `id` and the Vercel `requestId`
(the same id Vercel's log view shows for the request). A `processing` line with no `ok` / `failed` after it means the
function was cut off (`maxDuration` is 60 s).

A `failed` / `unexpected_error` line carries an `error` object: `name`, `message`, the top of the `stack`, any fields the error
has (a Supabase error's `code`, `details`, `hint`; a Zoho error's `status`, `zohoCode`, `path`) and its `cause` chain (e.g. the
network error behind "fetch failed"), plus `stage` (saving the record, or refreshing the page cache). The Zoho lookups also
log a `[zoho-sync] contact_lookup_failed` warning when a customer's addresses couldn't be fetched (the quote is still saved).
The 400 response body has the same `received` summary, so Zoho's Workflow Logs show it too. Set `ZOHO_WEBHOOK_DEBUG=1` to
also log every accepted payload. If nothing is logged, the request never reached the app (check the URL and Vercel's
deployment protection).

Zoho's Workflow Logs show response **headers** even when they hide the body, so every response carries `X-Webhook-Build`
(the commit and branch that answered — if this header is missing, an older deployment is still serving) and, once the secret
has been verified, an error carries `X-Webhook-Error` (the reason plus what was received). The health check (`GET` on the
endpoint) also reports `build`. Values in `ZOHO_WEBHOOK_SECRET` / `ZOHO_BOOKS_ORG_ID` are compared after trimming stray
whitespace or surrounding quotes; changing an environment variable in Vercel needs a redeploy to take effect.

**Set up** (once, then repeat steps 2–3 for each row of the table above)
1. Set `ZOHO_WEBHOOK_SECRET` (Vercel → Environment Variables, and `.env.local` for local runs; mark it Sensitive) and make sure
   `ZOHO_BOOKS_ORG_ID` is set. Redeploy so the server picks them up. Both webhooks can use the same secret.
2. Zoho Books → **Settings → Automation → Workflow Actions → Webhooks → + New Webhook**: the module (Quotes / Sales Orders),
   method **POST**, URL `https://<your-domain>/api/zoho/webhooks/quotes` (or `/sales-orders`), an **HTTP header**
   `X-Zoho-Webhook-Secret` = the secret, and a JSON body containing the record id and `organization_id`. Save.
3. **Settings → Automation → Workflow Rules → + New Workflow Rule**: same module, trigger **Created or Edited** (or
   **Deleted** for the delete endpoints); under Actions add type **Webhooks** and pick the webhook from step 2. Save.
4. Create, edit or delete a quote / sales order in Zoho, then check **Settings → Automation → Workflow Logs** in Zoho
   (status *Success*) and the record in the dashboard.

Zoho waits 10 s for a reply and treats anything other than 2xx as failed (it retries automatically), so failures are
returned as errors rather than hidden. `401` means the secret header is missing or wrong; `400` means the payload had no
`quote_id` / `sales_order_id` / `organization_id`, or the organization differs; `500` carries the error message.

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
| `ZOHO_WEBHOOK_SECRET` | 12–50 letters/digits, same as the Zoho webhook's secret token — mark as **Sensitive** |

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
  app/api/zoho/             # item image route + webhooks/{quotes,sales-orders}[/delete] (Zoho → app)
  lib/zoho/                 # Zoho Books API client + sync logic
  lib/supabase/             # browser, server, proxy clients + env (URL + anon key)
  lib/auth.ts               # requireUser(): user + profile
scripts/
  db.mjs                    # migration runner (uses DB password from .env.local)
  seed.mjs                  # admin seeder (uses service role key)
supabase/
  migrations/               # schema (profiles, sales orders, sync runs, dispatch batches)
```
