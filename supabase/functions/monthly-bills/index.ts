/* monthly-bills: make the month's bills and send them to tenants on LINE; daily reminders.
 *
 * Who may call it (deployed with verify_jwt = false, so this code decides):
 *   - the scheduled job (pg_cron), with header  x-cron-secret: <CRON_SECRET>
 *   - a logged-in admin or staff member (the app's "Generate & send via LINE" button)
 * Anyone else gets 401/403.
 *
 * POST { mode: 'monthly' }              cron, 1st of the month 08:00 Bangkok: bills for THIS month
 *                                       (rent + common fee of this month, electric/water of last month)
 * POST { mode: 'remind' }               cron, daily 09:00 Bangkok: reminders for unpaid bills
 * POST { mode: 'send', month }          app button: bills for that (bill) month
 * The cron modes do nothing while "auto_send_enabled" is off in Settings.
 *
 * Each bill is sent at most once: bills.line_sent_at is claimed with a conditional update before
 * the message goes out (and released again if LINE refuses it), so running twice is safe.
 * Rooms without a bill (no reading / meter backwards / no earlier reading) are listed in the
 * summary, which is saved in line_send_runs and, for the monthly run, pushed to the owner's LINE.
 *
 * Each bill message ends with a "View invoice" link (a new token per send, see _shared/invoicelink.ts)
 * when APP_URL is set; without it the message is sent as before, without the link.
 *
 * Secrets (Edge Function secrets): LINE_CHANNEL_ACCESS_TOKEN, CRON_SECRET; APP_URL (the app's address). */
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import {
  bangkokToday, billMessage, daysBetween, emptySummary, reminderMessage, summaryMessage, timingSafeEqual,
  type RunSummary,
} from '../_shared/core.ts';
import { forMessage, loadBills, loadSettings, payButtons, type LoadedBill } from '../_shared/bills.ts';
import { hashToken, invoiceUrl, LINK_DAYS, newToken } from '../_shared/invoicelink.ts';
import { push, text, textWithButtons } from '../_shared/line.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const REMIND_EVERY_MS = (3 * 24 - 1) * 3600 * 1000;   // 3 days (minus an hour, so the 09:00 job is not missed by minutes)

type Caller = { kind: 'cron' } | { kind: 'user'; id: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const caller = await authorize(req);
  if (caller === 'denied') return json({ error: 'NOT_ALLOWED' }, 403);
  if (!caller) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  let mode = '', month = '';
  try {
    const b = await req.json() as { mode?: string; month?: string };
    mode = String(b.mode ?? '');
    month = String(b.month ?? '');
  } catch { /* checked below */ }

  const allowed = caller.kind === 'cron' ? ['monthly', 'remind'] : ['send'];
  if (!allowed.includes(mode)) return json({ error: 'BAD_REQUEST' }, 400);
  if (mode === 'send' && !/^[0-9]{4}-[0-9]{2}-01$/.test(month)) return json({ error: 'BAD_MONTH' }, 400);

  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return json({ error: 'LINE_NOT_CONFIGURED' }, 500);

  try {
    const settings = await loadSettings(db);
    if (caller.kind === 'cron' && !settings.auto_send_enabled) return json({ ok: true, skipped: 'AUTO_SEND_OFF' });

    if (mode === 'remind') {
      const summary = await sendReminders(token);
      if (summary.reminded.length || summary.failed.length) await saveRun(summary, null);
      return json({ ok: true, summary });
    }

    const target = mode === 'monthly' ? bangkokToday().slice(0, 7) + '-01' : month;
    const summary = emptySummary(mode === 'monthly' ? 'monthly' : 'manual', target);
    await generate(target, summary);
    await sendBills(token, target, summary);
    await saveRun(summary, caller.kind === 'user' ? caller.id : null);

    // The scheduled run tells the owner on LINE (the button shows the summary in the app instead).
    if (mode === 'monthly' && settings.summary_line_user_id) {
      try { await push(token, settings.summary_line_user_id, [text(summaryMessage(summary))]); }
      catch (e) { console.error('monthly-bills: summary push failed:', errMsg(e)); }
    }
    return json({ ok: true, summary });
  } catch (e) {
    console.error('monthly-bills failed:', errMsg(e));
    return json({ error: 'FAILED', message: errMsg(e) }, 500);
  }
});

/** cron secret -> cron; member's JWT -> user; a valid login without a role -> 'denied'; else null. */
async function authorize(req: Request): Promise<Caller | 'denied' | null> {
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  const given = req.headers.get('x-cron-secret');
  if (given !== null) return secret.length >= 32 && timingSafeEqual(given, secret) ? { kind: 'cron' } : null;

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return null;
  const { data: prof } = await db.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  return prof?.role === 'admin' || prof?.role === 'staff' ? { kind: 'user', id: data.user.id } : 'denied';
}

async function generate(month: string, s: RunSummary) {
  const { data, error } = await db.rpc('generate_bills', { p_month: month });
  if (error) throw new Error(`generate_bills: ${error.message}`);
  for (const r of (data ?? []) as { room_number: string; outcome: string }[]) {
    if (r.outcome === 'created') s.created.push(r.room_number);
    else if (r.outcome === 'no_reading') s.no_reading.push(r.room_number);
    else if (r.outcome === 'meter_backwards') s.meter_backwards.push(r.room_number);
    else if (r.outcome === 'no_previous_reading') s.no_previous_reading.push(r.room_number);
  }
}

async function sendBills(token: string, month: string, s: RunSummary) {
  const bills = await loadBills(db, { month });
  for (const x of bills) {
    const room = x.bill.room_number;
    if (Number(x.bill.balance) <= 0) { s.paid.push(room); continue; }
    if (x.bill.line_sent_at) { s.already_sent.push(room); continue; }
    const to = x.tenant?.line_user_id;
    if (!to) { s.not_linked.push(room); continue; }

    // Claim the bill first: of two runs at the same time, only one gets it.
    const { data: claimed, error } = await db.from('bills').update({ line_sent_at: new Date().toISOString() })
      .eq('id', x.bill.id).is('line_sent_at', null).select('id');
    if (error) { s.failed.push({ room, error: error.message }); continue; }
    if (!claimed?.length) { s.already_sent.push(room); continue; }

    try {
      const link = await invoiceLink(x.bill.id);
      await push(token, to, [textWithButtons(billMessage({ ...forMessage(x), invoice_url: link }), payButtons(x.bill.id, x.lastChoice))]);
      s.sent.push(room);
    } catch (e) {
      await db.from('bills').update({ line_sent_at: null }).eq('id', x.bill.id);   // not sent: can be sent again
      s.failed.push({ room, error: errMsg(e) });
    }
  }
}

/** Unpaid bills already sent on LINE: from 1 day before the due date, at most every 3 days,
 *  and not while a slip for the bill is waiting to be checked. */
async function sendReminders(token: string): Promise<RunSummary> {
  const s = emptySummary('reminders', null);
  const today = bangkokToday();
  const now = Date.now();
  const bills = (await loadBills(db, { open: true })).filter((x) => x.bill.line_sent_at && x.tenant?.line_user_id);
  if (bills.length === 0) return s;

  const { data: pending } = await db.from('payment_slips').select('bill_id').eq('status', 'pending')
    .in('bill_id', bills.map((x) => x.bill.id));
  const slipWaiting = new Set((pending ?? []).map((p) => p.bill_id));

  const due = (x: LoadedBill) =>
    daysBetween(today, x.bill.due_date) <= 1 &&
    now - Date.parse(x.bill.line_sent_at!) >= 24 * 3600 * 1000 &&
    (!x.bill.line_reminded_at || now - Date.parse(x.bill.line_reminded_at) >= REMIND_EVERY_MS) &&
    !slipWaiting.has(x.bill.id);

  for (const x of bills.filter(due)) {
    const room = x.bill.room_number;
    const before = x.bill.line_reminded_at;
    const cutoff = new Date(now - REMIND_EVERY_MS).toISOString();
    const { data: claimed, error } = await db.from('bills').update({ line_reminded_at: new Date(now).toISOString() })
      .eq('id', x.bill.id).or(`line_reminded_at.is.null,line_reminded_at.lte."${cutoff}"`).select('id');
    if (error) { s.failed.push({ room, error: error.message }); continue; }
    if (!claimed?.length) continue;
    try {
      await push(token, x.tenant!.line_user_id!, [textWithButtons(
        reminderMessage({ room, tenant: x.tenant, month: x.bill.month, due_date: x.bill.due_date, balance: x.bill.balance }, today),
        payButtons(x.bill.id, x.bill.pay_method_chosen ?? x.lastChoice),
      )]);
      s.reminded.push(room);
    } catch (e) {
      await db.from('bills').update({ line_reminded_at: before }).eq('id', x.bill.id);
      s.failed.push({ room, error: errMsg(e) });
    }
  }
  return s;
}

/** A new "View invoice" link for the bill (replacing any earlier one), or null when APP_URL is not
 *  set or the link could not be saved (the bill is then sent without it). */
async function invoiceLink(billId: string): Promise<string | null> {
  const appUrl = Deno.env.get('APP_URL') ?? '';
  if (!/^https:\/\/[^\s]+$/.test(appUrl)) return null;
  const tok = newToken();
  const { error } = await db.from('invoice_links').upsert({
    bill_id: billId, token_hash: await hashToken(tok),
    created_at: new Date().toISOString(), expires_at: new Date(Date.now() + LINK_DAYS * 86400 * 1000).toISOString(),
  }, { onConflict: 'bill_id' });
  if (error) { console.error('monthly-bills: invoice link not saved:', error.message); return null; }
  return invoiceUrl(appUrl, tok);
}

async function saveRun(s: RunSummary, by: string | null) {
  const { error } = await db.from('line_send_runs').insert({ kind: s.kind, month: s.month, ran_by: by, summary: s });
  if (error) console.error('monthly-bills: could not save the run summary:', error.message);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
