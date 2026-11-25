/* line-webhook: receives events from the dorm's LINE Official Account.
 *
 * Deployed with verify_jwt = false (LINE sends no Supabase token). Its protection is the
 * x-line-signature check: every request whose body is not signed with LINE_CHANNEL_SECRET
 * is rejected with 401 before anything is read or written.
 *
 * Handles:
 *   follow                      -> reply "please type your room number"
 *   text that is a room number  -> one pending link request (staff approve it in the app)
 *                                  and reply "waiting for staff to confirm"
 *   postback "pay=...&bill=..." -> the payment button under a bill: PromptPay QR (exact balance),
 *                                  bank details, or office location/hours. Saved on the bill.
 *   image from a linked tenant  -> a payment slip: stored in the private "slips" bucket, its QR
 *                                  reference saved (UNIQUE: a second copy is flagged as duplicate),
 *                                  staff check and confirm it in the app. Never marks a bill paid.
 * A room number never links by itself: only staff approval does (line-link function).
 *
 * Secrets (Edge Function secrets, never in code): LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase to every function. */
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { MSG, PAY_REPLY, SLIP_REPLY, parsePayPostback, parseRoomNumber, verifyLineSignature } from '../_shared/core.ts';
import { loadBills, loadSettings, payButtons } from '../_shared/bills.ts';
import { getContent, getProfile, image, reply, text, textWithButtons, type LineMessage } from '../_shared/line.ts';
import { promptPayKind, promptPayPayload, slipKey } from '../_shared/promptpay.ts';
import { qrPng } from '../_shared/qrimage.ts';
import { readSlipQr } from '../_shared/slipqr.ts';

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type?: string; userId?: string };
  message?: { id?: string; type?: string; text?: string };
  postback?: { data?: string };
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
  const answerWith = (msgs: LineMessage[]) => (ev.replyToken ? reply(token, ev.replyToken, msgs) : Promise.resolve());
  const answer = (msg: string) => answerWith([text(msg)]);

  if (ev.type === 'follow') {
    await answer(MSG.askRoom);
    return;
  }

  if (ev.type === 'postback') {
    await handlePayButton(userId, ev.postback?.data, answerWith);
    return;
  }

  if (ev.type === 'message' && ev.message?.type === 'image' && ev.message.id) {
    const linked = await linkedTenantOf(userId);
    if (!linked) { await answer(MSG.askRoom); return; }
    await answer(await saveSlip(userId, linked, ev.message.id, token));
    return;
  }

  if (ev.type !== 'message' || ev.message?.type !== 'text') return;

  const linkedRoom = (await linkedTenantOf(userId))?.room ?? null;
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

type Linked = { tenantId: string; room: string; contractIds: string[] };

/** The tenant this LINE user is linked to, with the room of their active contract; null if not linked. */
async function linkedTenantOf(userId: string): Promise<Linked | null> {
  const { data, error } = await db.from('tenants')
    .select('id, contracts(id, status, rooms(number))')
    .eq('line_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const contracts = (data.contracts ?? []) as unknown as { id: string; status: string; rooms: { number: string } | null }[];
  const active = contracts.find((c) => c.status === 'active');
  if (!active?.rooms) return null;
  return { tenantId: data.id, room: active.rooms.number, contractIds: contracts.map((c) => c.id) };
}

/* ------------------------------------------------------------------ payment buttons */
async function handlePayButton(userId: string, data: string | undefined, answerWith: (m: LineMessage[]) => Promise<void>) {
  const choice = parsePayPostback(data);
  if (!choice) return;
  const [x] = await loadBills(db, { ids: [choice.billId] });
  // Only the tenant the bill belongs to gets its payment details.
  if (!x || !x.tenant?.line_user_id || x.tenant.line_user_id !== userId) {
    await answerWith([text(PAY_REPLY.notYours)]);
    return;
  }
  const balance = Number(x.bill.balance);
  if (balance <= 0) { await answerWith([text(PAY_REPLY.paid)]); return; }

  const { error } = await db.from('bills')
    .update({ pay_method_chosen: choice.method, pay_method_chosen_at: new Date().toISOString() }).eq('id', x.bill.id);
  if (error) console.error('line-webhook: could not save the payment choice:', error.message);

  const s = await loadSettings(db);
  const room = x.bill.room_number;
  // "Not set up" keeps the buttons, so the tenant can pick another way.
  const notReady = () => answerWith([textWithButtons(PAY_REPLY.notReady, payButtons(x.bill.id, null))]);

  if (choice.method === 'promptpay') {
    if (!promptPayKind(s.promptpay_id)) { await notReady(); return; }
    const url = await promptPayImageUrl(x.bill.id, s.promptpay_id, balance);
    await answerWith([text(PAY_REPLY.promptpay(room, balance)), image(url)]);
    return;
  }
  const msg = choice.method === 'transfer' ? PAY_REPLY.transfer(room, balance, s) : PAY_REPLY.cash(room, balance, s);
  if (!msg) { await notReady(); return; }
  await answerWith([text(msg)]);
}

/** PNG of the PromptPay QR for the exact amount, in the private "promptpay-qr" bucket, as a
 *  signed link LINE can download (valid 60 days). */
async function promptPayImageUrl(billId: string, promptpayId: string, amount: number): Promise<string> {
  const path = `${billId}/${amount.toFixed(2)}-${promptpayId.slice(-4)}.png`;
  const png = await qrPng(promptPayPayload(promptpayId, amount));
  const bucket = db.storage.from('promptpay-qr');
  const { error: upErr } = await bucket.upload(path, png, { contentType: 'image/png', upsert: true });
  if (upErr) throw new Error(`QR upload: ${upErr.message}`);
  const { data, error } = await bucket.createSignedUrl(path, 60 * 24 * 3600);
  if (error || !data) throw new Error(`QR link: ${error?.message}`);
  return data.signedUrl;
}

/* ------------------------------------------------------------------ payment slips */
async function saveSlip(userId: string, linked: Linked, messageId: string, token: string): Promise<string> {
  const { bytes, type } = await getContent(token, messageId);
  const ext = type.includes('png') ? 'png' : 'jpg';
  const path = `${linked.tenantId}/${messageId}.${ext}`;
  const { error: upErr } = await db.storage.from('slips')
    .upload(path, bytes, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
  if (upErr) throw new Error(`slip upload: ${upErr.message}`);

  let qrText: string | null = null;
  try { qrText = readSlipQr(bytes); } catch (e) { console.error('line-webhook: slip QR not readable:', e instanceof Error ? e.message : String(e)); }
  const ref = slipKey(qrText);

  // The slip is probably for the oldest unpaid bill; staff see it next to the slip.
  const open = await loadBills(db, { contractIds: linked.contractIds, open: true });
  const billId = open[0]?.bill.id ?? null;

  const row = { line_message_id: messageId, line_user_id: userId, tenant_id: linked.tenantId, bill_id: billId,
    storage_path: path, qr_text: qrText, qr_ref: ref };
  const first = await db.from('payment_slips').insert({ ...row, slip_ref: ref });
  if (!first.error) return SLIP_REPLY.received;
  if (first.error.code !== '23505') throw first.error;
  if (first.error.message.includes('line_message_id')) return SLIP_REPLY.received;   // LINE delivered the same image twice

  // Same QR reference as an earlier slip: keep it, flagged as a duplicate of that one.
  const { data: orig } = await db.from('payment_slips').select('id').eq('slip_ref', ref!).maybeSingle();
  const dup = await db.from('payment_slips').insert({ ...row, slip_ref: null, duplicate_of: orig?.id ?? null });
  if (dup.error && dup.error.code !== '23505') throw dup.error;
  return SLIP_REPLY.duplicate;
}
