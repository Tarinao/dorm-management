# Dorm Manager

A web app for running a 44-room dormitory, in Thai and English, that works on a phone.

- **Rooms & tenants**: room status, tenant details, contracts, check-in and check-out.
- **Meters & billing**: enter the electric meter, then make every bill for the month in one step. Water is a flat price per person.
- **Payments**: full or partial payments (cash / transfer), a printable receipt for each payment, and an overdue list.
- **Dashboard**: occupancy, expected vs collected income, outstanding balance, rooms with overdue bills.
- **How to use**: a step-by-step guide for workers, in Thai and English.

Built with React + Vite + TypeScript + Tailwind, and [Supabase](https://supabase.com) (database and login).

---

## 1. Create a Supabase project

1. Sign up at <https://supabase.com> and click **New project**. The free plan is enough.
2. Choose a name, a database password (save it somewhere safe) and the region closest to you (e.g. *Southeast Asia (Singapore)*).
3. Wait about 2 minutes until the project is ready.

## 2. Environment variables (`.env`)

The app reads the Supabase address and the **public** key from a file called `.env`. That file is git-ignored and is never committed.

1. In Supabase, open **Project Settings → API** (or the **Connect** button).
2. Copy `.env.example` to `.env` and fill in:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...      (the "publishable" / "anon" key)
```

> **Never** put the `service_role` / secret key in `.env` with a `VITE_` prefix, or anywhere in `src/`. Anything starting with `VITE_` is sent to every browser. The secret key is only used by the import script (step 6), and only typed into the terminal.

## 3. Apply the database migrations

All tables, security rules and functions are in `supabase/migrations/`. Apply them **in filename order**:

| File | What it does |
|---|---|
| `20261123134324_drop_legacy.sql` | Removes the tables of the old prototype (harmless on a new project) |
| `20261123134358_core_schema.sql` | Tables: profiles, settings, rooms, tenants, contracts, meter_readings, bills, bill_extras, payments |
| `20261123134401_rls.sql` | Row Level Security: who may read/write what (admin / staff) |
| `20261123134441_views_functions.sql` | `bill_summary` view, payment guard, move-in / move-out / bill generation |
| `20261123134455_seed_rooms_settings.sql` | The 44 rooms and the settings row |
| `20261123140852_water_per_person.sql` | Water = price per person (105 old customer / 150 new customer), prices kept per room |
| `20261123151116_no_water_meter.sql` | The water meter is no longer read |
| `20261124144133_admin_only_prices.sql` | Only the owner (admin) can change rent / water prices |
| `20261124144201_line_linking.sql` | Payment details in Settings, tenant nickname, LINE link requests, approve / reject, move-out clears the LINE link |
| `20261125093453_line_billing.sql` | Bills on LINE: sent / reminded / payment choice on each bill, payment slips (duplicate check), send-run summaries, private storage buckets |
| `20261125100100_line_cron_jobs.sql` | Schedules the monthly bills (1st, 08:00) and daily reminders (09:00). **Apply last, after the cron secret exists** (see "LINE" below) |

**Option A: SQL editor (no tools to install).** In Supabase open **SQL Editor → New query**. Paste the whole content of the first file, click **Run**, and repeat for each file in order.

**Option B: Supabase CLI.**
```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

To check it worked, open **Table Editor**: you should see the tables, with 44 rows in `rooms`.

## 4. Create the first admin (the owner)

1. In Supabase open **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick *Auto confirm user*.
2. Open **SQL Editor** and run, with your own email:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   (A profile row is created automatically when a user is added. New users start with **no access** until a role is given.)
3. **Turn off public sign-ups**: **Authentication → Sign In / Providers → Email**, and switch off *Allow new users to sign up*. You add staff yourself from then on.
4. **Staff accounts:** add each worker in **Authentication → Users** the same way. Then, logged in as admin, open **Settings → Staff accounts** in the app and set them to *Staff*.

| | Owner (admin) | Staff |
|---|---|---|
| Rooms, check-in / check-out, meters, bills, payments, receipts | ✔ | ✔ |
| Change room prices (rent, water price, people) | ✔ | ✘ (shown read-only; check-in uses the room's prices) |
| Settings page (rates, due day, staff access) | ✔ | ✘ |
| Delete anything (bills, extra charges, payments) | ✔ | ✘ |

These rules are enforced by the database (RLS policies and triggers), not only by hiding buttons.

## 5. Run the app on your computer

Needs [Node.js](https://nodejs.org) 22.18 or newer (24 recommended).

```bash
npm install
npm run dev          # opens http://localhost:5173
```

Log in with the admin account from step 4.

## 6. Import the old data (one time)

`scripts/import-old-data.ts` copies the old app's data into the new tables. It reads:

- `data/live_backup_2026-11-23.json`: the old Supabase tables, exported before they were dropped
- `data/old_tenants.json`: the backup file of the old Claude-artifact app

The `data/` folder is git-ignored because it contains tenant data.

The script **never overwrites** what you have already entered in the new app. A room that already has a tenant is skipped, and so is a bill that already exists. Running it twice is safe.

**Always do a dry run first.** It prints what would be imported or skipped, with the reason for each, and writes nothing:

```powershell
# PowerShell (Windows). Paste the secret key from Project Settings → API → service_role / secret.
$env:SUPABASE_SERVICE_ROLE_KEY="paste-the-secret-key-here"
npm run import:old -- --dry-run
```
```bash
# macOS / Linux / Git Bash
SUPABASE_SERVICE_ROLE_KEY=paste-the-secret-key-here npm run import:old -- --dry-run
```

If the report looks right, run the same command with `--apply` instead of `--dry-run`. Afterwards, close the terminal or run `Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY`, so the key does not stay set.

Without the secret key you can still dry-run against a saved copy of the database: `npm run import:old -- --dry-run --snapshot data/db_snapshot_2026-11-24.json`.

What is imported, and how:

| Old data | New app |
|---|---|
| Dorm name | Settings, only if the new app still has the default name "My Dorm" |
| Electric rate, water per person, due day | Compared only. The values set in the new app are kept |
| Room rent / floor / notes | Updated if different and the room has no tenant now. If the two old files disagree, the room is skipped and reported |
| Tenants | Tenant + active contract, only for rooms that are empty in the new app. Records with no name or no move-in date are skipped |
| Bills | Bill (rent + electric) + extra charges (common fee, other) + a payment marked *imported* if it was paid. Checked: the parts must add up to the old total |
| Owner name, PromptPay, language, repairs | Not imported (these features are not in the new app) |

## 7. Put it online (Cloudflare Workers)

The repo includes `wrangler.jsonc`, which serves the built `dist/` folder.

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, then pick this GitHub repo.
2. Build command `npm run build`, deploy command `npx wrangler deploy`, root `/`.
3. **Settings → Build → Variables and secrets**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (plain text). They are needed **at build time**. The runtime "Variables" section does not work for this.
4. Redeploy. Then in Supabase **Authentication → URL Configuration**, set *Site URL* to your `https://….workers.dev` address.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run locally |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Type check + production build into `dist/` (one `index.html`) |
| `npm run test:billing` | Bill calculations (3 example rooms incl. a partial payment), rounding, due dates, dashboard totals |
| `npm run test:guide` | The guide has all topics (5 + 3 LINE), every step in both Thai and English |
| `npm run test:line` | LINE signature check, room numbers typed in the chat, "101 (nickname)" labels |
| `npm run test:promptpay` | PromptPay QR payload and CRC16, slip QR references, payment buttons, bill/reminder/summary messages |
| `npm run import:old -- --dry-run` | Import report (writes nothing) |

## How billing works

- **Rent**: the room's monthly rent.
- **Water**: number of people × the room's water price per person (105 old customer / 150 new customer, set in Settings).
- **Electric**: (this month's meter − previous reading) × the electric rate per unit, rounded to 2 decimals.
- **Extras**: any extra charges added to the bill (parking, cleaning…).
- **Due date**: the due day (Settings) of the **following** month. After that date, an unpaid bill counts as *overdue*.
- **Payments**: several payments per bill are allowed. The status (*unpaid / partly paid / paid*) is computed from them, and the database refuses a payment larger than the balance. Each payment gets a receipt number (`R-000001`, …).

Money is shown in Thai baht with 2 decimals (฿1,234.50). Dates are shown as DD/MM/YYYY, with the Buddhist year in Thai (24/11/2569).

## LINE

The LINE Official Account talks to three Edge Functions in `supabase/functions/`:

| Function | Called by | Protection |
|---|---|---|
| `line-webhook` | LINE (every chat message, button tap, slip photo) | `verify_jwt = false`; every request must carry LINE's signature made with `LINE_CHANNEL_SECRET` |
| `line-link` | The app's Approve / Reject buttons | Logged-in users only; runs as that user (RLS) |
| `monthly-bills` | The scheduled jobs, and the app's "Generate & send via LINE" | `verify_jwt = false`; accepts only the cron secret header or a logged-in admin/staff login |

Webhook URL for the LINE Developers console: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/line-webhook`
(Messaging API tab → Webhook URL → Verify, then turn **Use webhook** on. In LINE OA Manager → Response settings, turn **Auto-response messages off** and **Webhooks on**.)

**Secrets** (Supabase → Edge Functions → Secrets; never in code, `.env` or git): `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `CRON_SECRET`.

### LINE: scheduled jobs

The jobs send the cron secret to `monthly-bills`; it must be stored in **two** places with the same value.

1. Supabase → **SQL Editor**, run once (it makes a random 64-character secret inside the database and shows it to you once):
   ```sql
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'monthly-bills cron secret');
   select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret';
   ```
2. Copy the shown value into **Edge Functions → Secrets** as `CRON_SECRET`. Do not paste it anywhere else.
3. Apply `20261125100100_line_cron_jobs.sql`.
4. In the app: **Settings → Send bills on LINE automatically** on. While it is off, the jobs run but do nothing.

To stop the jobs: `select cron.unschedule('line-monthly-bills'); select cron.unschedule('line-bill-reminders');`

LINE's free plan includes a limited number of pushed messages per month (bills, reminders, approvals). Replies to a tenant's button tap are free.

## Troubleshooting

- **"Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY"**: `.env` is missing or incomplete (locally), or the Cloudflare *build* variables are not set. Fix it, then restart `npm run dev` or rebuild.
- **"Waiting for approval" after logging in**: the account has no role yet. See step 4.
- **"You do not have permission for this"** or **"Only the owner can change prices"**: a staff account tried something only the owner can do.
