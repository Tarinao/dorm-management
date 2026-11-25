/* line-link: the app's "Approve" / "Reject" buttons for LINE link requests.
 *
 * Deployed WITH JWT verification (the default): only a logged-in user reaches this code, and
 * the database work runs AS THAT USER (their token is forwarded), so the RLS policies and the
 * is_member() check inside approve_line_request / reject_line_request decide what is allowed.
 * This function only adds what the browser must never have: the LINE access token, to send
 * the tenant a message.
 *
 * POST { action: 'approve' | 'reject', request_id: uuid }
 *   -> { ok: true, room_number, label, line_display_name, previous_room, pushed, push_error? }
 *   -> { error: 'REQUEST_NOT_PENDING' | 'ROOM_HAS_NO_TENANT' | 'NOT_ALLOWED' | ... } (status 400/403) */
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { MSG, tenantLabel } from '../_shared/core.ts';
import { push, text } from '../_shared/line.ts';

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

  let action = '', requestId = '';
  try {
    const b = await req.json() as { action?: string; request_id?: string };
    action = String(b.action ?? '');
    requestId = String(b.request_id ?? '');
  } catch { /* handled below */ }
  if (!['approve', 'reject'].includes(action) || !/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: 'BAD_REQUEST' }, 400);

  // Acts as the logged-in user: RLS applies.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');

  if (action === 'approve') {
    const { data, error } = await db.rpc('approve_line_request', { p_request_id: requestId });
    if (error) return dbError(error);
    const row = (data as Record<string, string | null>[])[0];
    const room = row.room_number ?? '';
    const result = {
      ok: true,
      room_number: room,
      label: tenantLabel(room, { full_name: row.tenant_full_name, nickname: row.tenant_nickname }),
      line_display_name: row.line_display_name ?? '',
      previous_room: row.previous_room,
    };
    return json({ ...result, ...(await tryPush(token, row.line_user_id!, MSG.linked(room))) });
  }

  const { data, error } = await db.rpc('reject_line_request', { p_request_id: requestId });
  if (error) return dbError(error);
  const row = (data as Record<string, string>[])[0];
  return json({ ok: true, room_number: row.room_number_typed, ...(await tryPush(token, row.line_user_id, MSG.rejected(row.room_number_typed))) });
});

/** The link is already saved when this runs; a failed message is reported, not rolled back. */
async function tryPush(token: string | undefined, to: string, message: string) {
  if (!token) return { pushed: false, push_error: 'LINE_CHANNEL_ACCESS_TOKEN is not set' };
  try {
    await push(token, to, [text(message)]);
    return { pushed: true };
  } catch (e) {
    console.error('line-link: push failed:', e instanceof Error ? e.message : String(e));
    return { pushed: false, push_error: e instanceof Error ? e.message : String(e) };
  }
}

function dbError(error: { message?: string; code?: string }) {
  const m = error.message ?? '';
  const known = ['REQUEST_NOT_PENDING', 'ROOM_HAS_NO_TENANT', 'NOT_ALLOWED'].find((k) => m.includes(k));
  if (known) return json({ error: known }, known === 'NOT_ALLOWED' ? 403 : 400);
  if (error.code === '42501') return json({ error: 'NOT_ALLOWED' }, 403);
  console.error('line-link: database error:', m);
  return json({ error: 'DB_ERROR', message: m }, 500);
}
