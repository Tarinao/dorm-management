/* line-notify: tells a guest on LINE that staff confirmed their viewing or reservation.
 *
 * Deployed WITH JWT verification: only a logged-in user reaches this code, and every database
 * read runs AS THAT USER (their token is forwarded), so RLS decides what they may see. This
 * function only adds what the browser must never have: the LINE access token.
 *
 * It cannot be used to send arbitrary text: the message is built here from the row, and only
 * for a row that IS confirmed and came with a LINE account (booked through the bot).
 *
 * POST { kind: 'viewing' | 'reservation', id: uuid }
 *   -> { ok: true, pushed: true }
 *   -> { ok: true, pushed: false, reason: 'NO_LINE' | 'NOT_CONFIRMED' | 'PUSH_FAILED', push_error? }
 *   -> { error: 'NOT_FOUND' | 'BAD_REQUEST' | 'NOT_ALLOWED' } (status 400/401/404) */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import { push, text } from '../_shared/line.ts';
import { isLang } from '../_shared/lang.ts';
import { reservationConfirmedText, viewingConfirmedText, type NotifyPlace } from '../_shared/notify.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'NOT_ALLOWED' }, 401);

  let kind = '', id = '';
  try {
    const b = await req.json() as { kind?: string; id?: string };
    kind = String(b.kind ?? '');
    id = String(b.id ?? '');
  } catch { /* handled below */ }
  if (!['viewing', 'reservation'].includes(kind) || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'BAD_REQUEST' }, 400);

  // Acts as the logged-in user: RLS applies (members may read these tables; others see nothing).
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const table = kind === 'viewing' ? 'viewings' : 'reservations';
  const cols = kind === 'viewing'
    ? 'guest_name, line_user_id, status, visit_date, time_of_day, visit_time, rooms(number)'
    : 'guest_name, line_user_id, status, desired_move_in, expires_on, booking_fee, booking_fee_paid_on, rooms(number)';
  const { data, error } = await db.from(table).select(cols).eq('id', id).maybeSingle();
  if (error) {
    console.error('line-notify: read failed:', error.message);
    return json({ error: 'DB_ERROR' }, 500);
  }
  if (!data) return json({ error: 'NOT_FOUND' }, 404);
  const row = data as unknown as Record<string, unknown> & { rooms: { number: string } | null };

  if (!row.line_user_id) return json({ ok: true, pushed: false, reason: 'NO_LINE' });
  if (row.status !== 'confirmed') return json({ ok: true, pushed: false, reason: 'NOT_CONFIRMED' });

  const to = String(row.line_user_id);
  const [lang, place] = await Promise.all([chosenLang(db, to), placeInfo(db)]);
  const room = row.rooms?.number ?? null;
  const message = kind === 'viewing'
    ? viewingConfirmedText({
        guest_name: String(row.guest_name), visit_date: String(row.visit_date), time_of_day: String(row.time_of_day),
        visit_time: (row.visit_time as string | null) ?? null, room_number: room,
      }, lang, place)
    : reservationConfirmedText({
        guest_name: String(row.guest_name), room_number: room, desired_move_in: String(row.desired_move_in),
        expires_on: String(row.expires_on), booking_fee: row.booking_fee as number,
        booking_fee_paid_on: (row.booking_fee_paid_on as string | null) ?? null,
      }, lang, place);

  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return json({ ok: true, pushed: false, reason: 'PUSH_FAILED', push_error: 'LINE_CHANNEL_ACCESS_TOKEN is not set' });
  try {
    await push(token, to, [text(message)]);
    return json({ ok: true, pushed: true });
  } catch (e) {
    // The confirmation is already saved; a failed message is reported, not rolled back.
    console.error('line-notify: push failed:', e instanceof Error ? e.message : String(e));
    return json({ ok: true, pushed: false, reason: 'PUSH_FAILED', push_error: e instanceof Error ? e.message : String(e) });
  }
});

/** The language the person chose in the bot; null = never chose, so the message is bilingual. */
async function chosenLang(db: SupabaseClient, lineUserId: string) {
  const { data } = await db.from('line_users').select('lang').eq('line_user_id', lineUserId).maybeSingle();
  const lang = (data as { lang?: unknown } | null)?.lang;
  return isLang(lang) ? lang : null;
}

async function placeInfo(db: SupabaseClient): Promise<NotifyPlace> {
  const { data } = await db.from('settings').select('dorm_name, office_phone').eq('id', 1).maybeSingle();
  const s = (data ?? {}) as { dorm_name?: string | null; office_phone?: string | null };
  return { dormName: String(s.dorm_name ?? '').trim(), phone: String(s.office_phone ?? '').trim() };
}
