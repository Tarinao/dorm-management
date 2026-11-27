# Dorm Manager

A web app for running a 44-room dormitory, in Thai and English, that works on a phone.

- **Rooms & tenants**: room status, tenant details, contracts, check-in and check-out.
- **Meters & billing**: enter the electric meter, then make every bill for the month in one step. Water is a flat price per person.
- **Payments**: full or partial payments (cash / transfer), a printable receipt for each payment, and an overdue list.
- **Reservations**: bookings with a booking fee and a printable receipt, at most one active booking per room, "Convert to move-in" (the fee counts toward the deposit), automatic expiry.
- **Maintenance**: repair tickets with photos, priority and cost; a ticket can block a vacant room until it is fixed.
- **LINE OA chat**: welcome in Thai and English, language choice, menu, dorm information, "Connect my room", "Book a viewing" (a viewing appointment, not a reservation), "Contact staff" (the bot goes quiet so staff can chat).
- **Viewings**: people coming to see a room, from LINE or added by staff; confirm the time, mark viewed / no-show, and "Reserve a room" from a viewing.
- **Dashboard**: occupancy, expected vs collected income, outstanding balance, rooms with overdue bills, open repairs, bookings, and people who want to talk on LINE.
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
| `20261125104324_line_cron_jobs.sql` | Schedules the monthly bills (1st, 08:00 Bangkok) and daily reminders (09:00). Applied 2026-11-25. On a new project, apply it after the cron secret exists (see "LINE" below) |
| `20261126101653_reservations_maintenance.sql` | Reservations (one active booking per room, booking-fee receipts B-000001, expiry), maintenance tickets (block a vacant room), private "maintenance" photo bucket, move-in from a reservation, move-out keeps bookings / blocks, nightly expiry job (00:05 Bangkok). Applied 2026-11-26 |
| `20261126101711_line_bot.sql` | LINE chat: `line_users` (language, menu step, handover, "wants to talk"), `line_info` (dorm information in Thai + English, empty at first), office phone + map pin in Settings. Applied 2026-11-26 |
| `20261126193657_viewings.sql` | `viewings` (viewing appointments, separate from reservations; members read/add/edit, admin deletes), the bot's `book_time` step, and moves the LINE requests that were saved as pending reservations (no room, no fee) into `viewings`. Applied 2026-11-27 |
| `20261127071400_move_in_line.sql` | `move_in()` from a reservation links the reservation's LINE account to the new tenant (like an approved link request), unless that account belongs to a current tenant. No new tables. Applied 2026-11-27 |
| `20261127120000_billing_period_invoice.sql` | New billing period (bill of month M = rent + common fee for M, water + electric for M-1; first and final bills), one bill per contract and month, `settings.common_fee` (300) copied onto each bill and included in every total, invoice numbers `INV` + YYYYMM + 6 digits, invoice details in Settings, `tenants.address`, private "branding" bucket for the logo, `invoice_links` (hashed LINE invoice tokens, service role only). Existing bills keep their totals. **Not applied yet** |

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
| Reservations: create, confirm, cancel, convert to move-in | ✔ | ✔ |
| Maintenance tickets: create, edit, photos, close | ✔ | ✔ |
| LINE info (what the bot answers) | ✔ | ✘ |
| Delete anything (bills, extra charges, payments, reservations, tickets) | ✔ | ✘ |

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
| Bills | Bill (rent + common fee + electric, the old rule: all of one month) + extra charges (old water cost, other) + a payment marked *imported* if it was paid. Checked: the parts must add up to the old total |
| Common fee | Settings, only if the old app had one above 0 and the new app still has the default 300 |
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
| `npm run typecheck` | TypeScript check of the app and of the Edge Functions (`tsconfig.functions.json`, no Deno needed) |
| `npm run build` | Type check + production build into `dist/` (one `index.html`) |
| `npm run test:billing` | Billing period (December bill = December rent + common fee + November usage), first and final bills, a room changing tenants, common fee changes, rounding, due dates, dashboard totals |
| `npm run test:invoice` | Invoice: amount in Thai words (`bahtText`: satang, 0, round numbers, ล้าน, เอ็ด / ยี่), numbered lines, footer |
| `npm run test:guide` | The guide has all topics (5 + 3 LINE), every step in both Thai and English |
| `npm run test:line` | LINE signature check, room numbers typed in the chat, "101 (nickname)" labels |
| `npm run test:promptpay` | PromptPay QR payload and CRC16, slip QR references, payment buttons, bill/reminder/summary messages |
| `npm run test:bot` | The LINE conversation: follow → language → menu, one language afterwards, handover silence, the "menu" keyword, linked vs unlinked menus, booking a viewing (date + time of day), payment postbacks left alone, label lengths, rich menu |
| `npm run test:reservations` | Reservation rules: double booking, occupied rooms need a move-out date, maintenance blocks, room status afterwards, expiry, deposit credit |
| `npm test` | All of the test scripts above |
| `npm run richmenu:png` | Draws the LINE rich menu picture `supabase/line/richmenu.png` (nothing is sent anywhere) |
| `npm run import:old -- --dry-run` | Import report (writes nothing) |

## How billing works

Bills are made on the 1st of each month. The bill of month M has:

- **Rent** for M (in advance): the room's monthly rent.
- **Common fee** (ส่วนกลาง) for M: `settings.common_fee` (300 by default), copied onto the bill when it is made, so changing it later only affects new bills.
- **Water** for M-1: number of people × the room's water price per person (105 old customer / 150 new customer, set in Settings).
- **Electric** for M-1: (the M-1 meter reading − the reading before it) × the electric rate per unit, rounded to 2 decimals.
- **Extras**: any extra charges added to the bill (parking, cleaning…).
- **First bill** of a new contract (moved in during M): rent + common fee only. **Final bill** after a move-out during M-1: water + electric only, up to the move-out reading. A room changing tenants can have both in the same month (one bill per contract and month).
- **Due date**: the due day (Settings) of M. After that date, an unpaid bill counts as *overdue*.
- **Total** = rent + common fee + water + electric + extras, everywhere (bill list, dashboard, LINE message, PromptPay QR amount, payment limit).
- **Invoice**: each bill has a number `INV` + YYYYMM + 6 digits (`INV202612000013`), given once and never reused, and a printable A4 invoice ("Invoice" on a bill). The dorm details on it come from **Settings → Invoice details**.
- **Payments**: several payments per bill are allowed. The status (*unpaid / partly paid / paid*) is computed from them, and the database refuses a payment larger than the balance. Each payment gets a receipt number (`R-000001`, …).

Money is shown in Thai baht with 2 decimals (฿1,234.50). Dates are shown as DD/MM/YYYY, with the Buddhist year in Thai (24/11/2569).

## LINE

The LINE Official Account and the app use these Edge Functions in `supabase/functions/`:

| Function | Called by | Protection |
|---|---|---|
| `line-webhook` | LINE (every chat message, button tap, slip photo) | `verify_jwt = false`; every request must carry LINE's signature made with `LINE_CHANNEL_SECRET` |
| `line-link` | The app's Approve / Reject buttons | Logged-in users only; runs as that user (RLS) |
| `line-notify` | After "Confirm" on a viewing or reservation: tells the guest on LINE (fixed message built from the row; only for confirmed rows that came with a LINE account) | Logged-in users only; runs as that user (RLS) |
| `monthly-bills` | The scheduled jobs, and the app's "Generate & send via LINE" | `verify_jwt = false`; accepts only the cron secret header or a logged-in admin/staff login |
| `invoice` | The "View invoice" link at the end of each LINE bill (tenants are not logged in) | `verify_jwt = false`; the link's token (32 random bytes) is checked against its SHA-256 in `invoice_links` and expires after 90 days; returns only that bill. The page itself is the app's public route `#/i/<token>` (Edge Functions on supabase.co cannot serve HTML pages), marked noindex |

Webhook URL for the LINE Developers console: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/line-webhook`
(Messaging API tab → Webhook URL → Verify, then turn **Use webhook** on. In LINE OA Manager → Response settings, turn **Auto-response messages off** and **Webhooks on**.)

**Secrets** (Supabase → Edge Functions → Secrets; never in code, `.env` or git): `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `CRON_SECRET`, and `APP_URL` (the app's address, e.g. `https://….workers.dev`, used for the "View invoice" link; without it bills are sent without the link).

### LINE: scheduled jobs

The jobs send the cron secret to `monthly-bills`; it must be stored in **two** places with the same value.

1. Supabase → **SQL Editor**, run once (it makes a random 64-character secret inside the database and shows it to you once):
   ```sql
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'monthly-bills cron secret');
   select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret';
   ```
2. Copy the shown value into **Edge Functions → Secrets** as `CRON_SECRET`. Do not paste it anywhere else.
3. Apply `20261125104324_line_cron_jobs.sql`.
4. In the app: **Settings → Send bills on LINE automatically** on. While it is off, the jobs run but do nothing.

To stop the jobs: `select cron.unschedule('line-monthly-bills'); select cron.unschedule('line-bill-reminders');`

LINE's free plan includes a limited number of pushed messages per month (bills, reminders, approvals). Replies to a tenant's button tap are free.

## Reservations and maintenance

- **One active booking per room.** "Active" = waiting to confirm or confirmed. The database refuses a second one (unique index + trigger), so two people can never hold the same room, even from two phones at once.
- **Which rooms can be booked:** vacant rooms, and occupied rooms whose contract has an end date (the booking's move-in date must be on or after it). A room in maintenance cannot be booked or moved into.
- **Room status follows the booking:** confirming makes a vacant room *Reserved*; cancelling, expiring or deleting puts it back (*Occupied* / *Maintenance* / *Vacant*). When a booked tenant's room is checked out as "Vacant", it becomes *Reserved* for the next guest.
- **Booking fee:** amount, date and cash/transfer give a receipt `B-000001` (print it from the booking). "Convert to move-in" opens the check-in form with the guest's name, phone and date, and the paid fee is recorded on the contract as part of the deposit (`contracts.booking_fee_credit`).
- **Expiry:** each booking has an *expires on* date (7 days after the move-in date unless changed). Every night at 00:05 (Bangkok) the job `reservations-expire` closes bookings past that date. To stop it: `select cron.unschedule('reservations-expire');`
- **Viewings are not reservations.** "Book a viewing" in the LINE chat creates a *viewing* (page **Viewings**), which holds no room. After the visit, "Reserve a room" on the viewing opens a new reservation with the guest's name, phone and LINE account, and links the two.
- **Maintenance block:** "Block the room" on a ticket sets a vacant room to *Maintenance* while the ticket is open or in progress; done / cancelled (or unticking the box) frees it. Occupied rooms keep their status. Photos are in the private Storage bucket `maintenance` (staff see them through 1-hour links).

**Database tests.** `supabase/tests/reservations_maintenance.test.sql`, `supabase/tests/line_bot.test.sql`, `supabase/tests/viewings.test.sql` and `supabase/tests/move_in_line.test.sql` run every rule above against the real triggers, as an admin and as a staff login, inside one transaction that is **rolled back** at the end (nothing is kept). Run them in the SQL editor after applying the migrations. Before release they were run against all migrations on a local Postgres (PGlite); each passed, and each fails when an expectation is changed on purpose.

## LINE chat (welcome, menu, contact staff)

Everything in this section is in `line-webhook` and `supabase/functions/_shared/bot.ts`. All answers are replies (free); the only push is one notice to the owner when someone asks for staff.

1. **Follow:** a welcome in Thai and English, then [ภาษาไทย] [English]. The choice is saved (`line_users.lang`) and from then on the bot writes only in that language: menus, answers, room linking, payment-button replies, slip replies, and the approve / reject message from the app. (The monthly bill and reminder messages from `monthly-bills` are unchanged: Thai first, then English.)
2. **Main menu:** Dorm information · Connect my room (hidden once the LINE account is linked to a tenant) · Contact staff · Language.
3. **Dorm information:** room types & prices, available rooms (live count of *Vacant* rooms and their rent range), facilities, location (a LINE map pin + the address), house rules, deposit & contract terms, and "Book a viewing" (name → phone → date → Morning / Afternoon / Evening → a *requested* viewing; staff call to agree the exact time). The texts come from **Settings → LINE info** (Thai and English, owner only). An empty text makes the bot say the information is not available yet; nothing is hardcoded.
4. **Contact staff:** the bot answers with the office hours and phone (Settings), the person appears on the Dashboard under **Wants to talk** (red number), the owner's summary LINE account gets one message, and the bot stays quiet for that person for 12 hours so staff can chat in LINE OA Manager. Staff tap **Done** when finished (or "Done, let the bot answer again").
5. **"เมนู", "menu", "เริ่มใหม่", "start"** always bring the menu back, also during the quiet time. Anything else the bot does not understand gets a short "I didn't understand" and the menu, except during the quiet time.
6. **Unchanged:** a room number typed in the chat still creates a link request that staff approve; payment buttons and slips work exactly as before (slips are saved even during the quiet time).

**Rich menu (optional).** `npm run richmenu:png` draws `supabase/line/richmenu.png` (2500 × 843, app colours, four buttons: Info, My room, Contact, TH / EN). The buttons send the same postbacks as the menu, so they answer in the user's language. Creating it on the LINE account is a separate, explicit step that changes what every follower sees (created 2026-11-27). Run it in your own PowerShell window so the token never lands in a file or a chat log; `node` is used directly because PowerShell may block `npm.ps1`:
```powershell
$env:LINE_CHANNEL_ACCESS_TOKEN = Read-Host "Paste token"
node scripts/line-rich-menu.ts --create --yes        # or: --create --yes --image my-design.png
Remove-Item Env:LINE_CHANNEL_ACCESS_TOKEN
```
Remove it again in LINE OA Manager → Rich menus.

### Release order for these features

1. Apply `20261126101653_reservations_maintenance.sql`, then `20261126101711_line_bot.sql`. (Done 2026-11-26.)
2. Run the two files in `supabase/tests/` in the SQL editor (they roll back). (Done 2026-11-26: both passed.) Note: they use one booking receipt number, because sequences are not rolled back; reset with `select setval('public.booking_receipt_seq', 1, false);` while there are no bookings yet.
3. Deploy the web app (it reads the new tables, so not before step 1).
4. Fill in **Settings → LINE info**, office phone and map pin.
5. Deploy `line-link`, then `line-webhook`. (Done 2026-11-26, before the 1 December run at the owner's request; `monthly-bills` was not changed.)
6. Optional: create the rich menu. (Done 2026-11-27.)
7. Viewings: apply `20261126193657_viewings.sql` and run `supabase/tests/viewings.test.sql`, deploy the web app, then deploy `line-webhook` (the bot writes the new `book_time` step and the `viewings` table, so not before the migration). (Migration applied and test passed 2026-11-27; `line-webhook` v8, then v9 with LINE profile-picture refresh.)
8. Move-in carries LINE over: apply `20261127071400_move_in_line.sql`, run `supabase/tests/move_in_line.test.sql`, then deploy the web app. No function deploy needed. (Migration applied and test passed 2026-11-27.)
9. Confirm messages + ครับ: deploy `line-notify` (new), then `line-webhook`, `line-link` and `monthly-bills` (their Thai replies now end with ครับ; no logic changed), then the web app. Test: `npm run test:notify`.
10. Billing period, common fee and invoices: apply `20261127120000_billing_period_invoice.sql`, run `supabase/tests/billing_period.test.sql` (it rolls back, but uses invoice numbers: sequences are not rolled back), deploy the web app, set the `APP_URL` secret, deploy `invoice` (new) and `monthly-bills` (bills this month instead of last month, adds the invoice link). Then fill in **Settings → Invoice details** and the staff names. Tests: `npm run test:billing`, `npm run test:invoice`, `npm run test:promptpay`.

## Troubleshooting

- **"Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY"**: `.env` is missing or incomplete (locally), or the Cloudflare *build* variables are not set. Fix it, then restart `npm run dev` or rebuild.
- **"Waiting for approval" after logging in**: the account has no role yet. See step 4.
- **"You do not have permission for this"** or **"Only the owner can change prices"**: a staff account tried something only the owner can do.
- **"This room already has an active reservation"**: cancel or finish the other booking first (Reservations page, filter "Active").
- **"The current tenant has no move-out date"**: set the contract end date on the room page, then book the room.
- **"This room is reserved for someone else"**: use "Convert to move-in" on that booking, or cancel it.
- **The bot does not answer someone**: they probably tapped "Contact staff" less than 12 hours ago. Tap "Done, let the bot answer again" on the Dashboard, or ask them to type "menu".
