/* line-webhook: receives events from the dorm's LINE Official Account.
 *
 * Deployed with verify_jwt = false (LINE sends no Supabase token). Its protection is the
 * x-line-signature check: every request whose body is not signed with LINE_CHANNEL_SECRET
 * is rejected with 401 before anything is read or written.
 *
 * Phase 1 handles:
 *   follow                      -> reply "please type your room number"
 *   text that is a room number  -> one pending link request (staff approve it in the app)
 *                                  and reply "waiting for staff to confirm"
 * A room number never links by itself: only staff approval does (line-link function).
 *
 * Secrets (Edge Function secrets, never in code): LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase to every function. */
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { MSG, parseRoomNumber, verifyLineSignature } from '../_shared/core.ts';
import { getProfile, reply, text } from '../_shared/line.ts';

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type?: string; userId?: string };
  message?: { type?: string; text?: string };
};

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const secret = Deno.env.get('LINE_CHANNEL_SECRET');
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!secret || !token) {
    console.error('line-webhook: LINE secrets are not set');
    return new Response('Not configured', { status: 500 });
  }

  const body = await req.text();
  if (!(await verifyLineSignature(secret, body, req.headers.get('x-line-signature')))) {
    return new Response('Bad signature', { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    const parsed = JSON.parse(body) as { events?: LineEvent[] };
    events = Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  // One request can carry several events. Handle them in order; one failure does not stop the rest.
  for (const ev of events) {
    try {
      await handleEvent(ev, token);
    } catch (e) {
      console.error(`line-webhook: ${ev.type} event failed:`, e instanceof Error ? e.message : String(e));
    }
  }
  // Always 200 for a correctly signed request, so LINE does not retry events already handled.
  return new Response('OK');
});

async function handleEvent(ev: LineEvent, token: string) {
  const userId = ev.source?.type === 'user' ? ev.source.userId : undefined;
  if (!userId) return;                       // groups / rooms are not used
  const answer = (msg: string) => (ev.replyToken ? reply(token, ev.replyToken, [text(msg)]) : Promise.resolve());

  if (ev.type === 'follow') {
    await answer(MSG.askRoom);
    return;
  }

  if (ev.type !== 'message' || ev.message?.type !== 'text') return;

  const linkedRoom = await linkedRoomOf(userId);
  const room = parseRoomNumber(ev.message.text);

  if (!room) {
    // A linked tenant chatting with the office: leave it to staff in LINE OA Manager.
    if (!linkedRoom) await answer(MSG.askRoom);
    return;
  }

  const { data: found, error: roomErr } = await db.from('rooms').select('id, number').eq('number', room).maybeSingle();
  if (roomErr) throw roomErr;
  if (!found) {
    await answer(MSG.roomNotFound(room));     // an unknown room number never creates a request
    return;
  }

  if (linkedRoom === found.number) {
    await answer(MSG.alreadyLinked(found.number));
    return;
  }

  // Already waiting? Update the room they typed instead of adding another request.
  const { data: pending, error: pendErr } = await db.from('line_link_requests')
    .select('id').eq('line_user_id', userId).eq('status', 'pending').maybeSingle();
  if (pendErr) throw pendErr;

  if (pending) {
    const { error } = await db.from('line_link_requests')
      .update({ room_number_typed: found.number, created_at: new Date().toISOString() }).eq('id', pending.id);
    if (error) throw error;
  } else {
    const profile = await getProfile(token, userId);
    const { error } = await db.from('line_link_requests').insert({
      line_user_id: userId,
      line_display_name: profile.displayName,
      line_picture_url: profile.pictureUrl,
      room_number_typed: found.number,
    });
    // 23505 = a request was created a moment ago by a parallel event: that one counts.
    if (error && error.code !== '23505') throw error;
  }
  await answer(MSG.waiting);
}

/** The room number of the active contract this LINE user is linked to, or null. */
async function linkedRoomOf(userId: string): Promise<string | null> {
  const { data, error } = await db.from('tenants')
    .select('id, contracts(status, rooms(number))')
    .eq('line_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const active = (data?.contracts as { status: string; rooms: { number: string } | null }[] | undefined)
    ?.find((c) => c.status === 'active');
  return active?.rooms?.number ?? null;
}
