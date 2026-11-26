/* line-webhook: receives events from the dorm's LINE Official Account.
 *
 * Deployed with verify_jwt = false (LINE sends no Supabase token). Its protection is the
 * x-line-signature check: every request whose body is not signed with LINE_CHANNEL_SECRET
 * is rejected with 401 before anything is read or written.
 *
 * Handles:
 *   postback "pay=...&bill=..." -> the payment button under a bill: PromptPay QR (exact balance),
 *                                  bank details, or office location/hours. Saved on the bill.
 *                                  (Same logic as before; the reply is in the tenant's chosen
 *                                  language, or bilingual as before if none was chosen.)
 *   image from a linked tenant  -> a payment slip: stored in the private "slips" bucket, its QR
 *                                  reference saved (UNIQUE: a second copy is flagged as duplicate),
 *                                  staff check and confirm it in the app. Never marks a bill paid.
 *                                  Works also while staff are chatting (handover).
 *   everything else             -> the conversation in _shared/bot.ts: welcome + language choice
 *                                  on follow, main menu, dorm information (texts from line_info),
 *                                  connect my room (pending request, staff approve), book a
 *                                  viewing (a viewing appointment, not a reservation), contact staff.
 * A room number never links by itself: only staff approval does (line-link function).
 * Every answer is a REPLY (free). The only push is the one "wants to talk" notice to the owner.
 *
 * Secrets (Edge Function secrets, never in code): LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase to every function. */
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { PAY_REPLY, SLIP_REPLY, bangkokToday, parsePayPostback, verifyLineSignature } from '../_shared/core.ts';
import { loadBills, loadSettings, payButtons } from '../_shared/bills.ts';
import { getContent, getProfile, image, push, reply, text, textWithButtons, type LineMessage } from '../_shared/line.ts';
import { PAY_REPLY_1, SLIP_REPLY_1, isLang, type Lang } from '../_shared/lang.ts';
import { MENU_STATES, botReply, ownerNotice, type BotEvent, type BotPorts, type BotUser, type UserPatch } from '../_shared/bot.ts';
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

type LineUserRow = BotUser & { line_user_id: string; display_name: string };

async function handleEvent(ev: LineEvent, token: string) {
  const userId = ev.source?.type === 'user' ? ev.source.userId : undefined;
  if (!userId || !/^U[0-9a-f]{32}$/.test(userId)) return;   // groups / rooms are not used
  if (ev.type === 'unfollow') return;
  const answerWith = (msgs: LineMessage[]) => (ev.replyToken && msgs.length ? reply(token, ev.replyToken, msgs) : Promise.resolve());

  // The bot's own table must never stop payment buttons or slips (e.g. if this function were
  // deployed before migration 0013): on any problem they run as before, bilingual.
  let user: LineUserRow | null = null;
  try {
    user = await ensureUser(userId, token);
  } catch (e) {
    console.error('line-webhook: line_users not available:', e instanceof Error ? e.message : String(e));
  }
  const lang = user?.lang ?? null;

  // ---- payment buttons: unchanged logic
  if (ev.type === 'postback' && parsePayPostback(ev.postback?.data)) {
    await handlePayButton(userId, ev.postback?.data, answerWith, lang);
    return;
  }

  const linked = await linkedTenantOf(userId);

  // ---- slips from linked tenants: unchanged logic (also during handover)
  if (ev.type === 'message' && ev.message?.type === 'image' && ev.message.id && linked) {
    await answerWith([text(await saveSlip(userId, linked, ev.message.id, token, lang))]);
    return;
  }

  // ---- the conversation
  if (!user) return;
  let event: BotEvent;
  if (ev.type === 'follow') event = { kind: 'follow' };
  else if (ev.type === 'postback') event = { kind: 'postback', data: String(ev.postback?.data ?? '') };
  else if (ev.type === 'message' && ev.message?.type === 'text') event = { kind: 'text', text: String(ev.message.text ?? '') };
  else if (ev.type === 'message') event = { kind: 'other' };
  else return;                                              // join, leave, beacon, ...

  const result = await botReply(event, user, await ports(user, linked, token));
  if (!result) return;
  await saveUser(userId, result.patch);
  await answerWith(result.messages as LineMessage[]);
}

/* ------------------------------------------------------------------ line_users */
/** The user's row (created on first contact, with their LINE name), last_seen updated. */
async function ensureUser(userId: string, token: string): Promise<LineUserRow> {
  const cols = 'line_user_id, display_name, lang, menu_state, draft, handover_until';
  const { data, error } = await db.from('line_users').select(cols).eq('line_user_id', userId).maybeSingle();
  if (error) throw error;
  let row = data as Record<string, unknown> | null;
  if (!row) {
    const profile = await getProfile(token, userId);
    const ins = await db.from('line_users')
      .upsert({ line_user_id: userId, display_name: profile.displayName, picture_url: profile.pictureUrl }, { onConflict: 'line_user_id', ignoreDuplicates: true })
      .select(cols).maybeSingle();
    if (ins.error) throw ins.error;
    row = (ins.data as Record<string, unknown> | null) ?? { line_user_id: userId, display_name: profile.displayName };
  } else {
    const { error: upErr } = await db.from('line_users').update({ last_seen: new Date().toISOString() }).eq('line_user_id', userId);
    if (upErr) console.error('line-webhook: last_seen:', upErr.message);
  }
  return {
    line_user_id: userId,
    display_name: String(row.display_name ?? ''),
    lang: isLang(row.lang) ? row.lang : null,
    menu_state: MENU_STATES.find((s) => s === row!.menu_state) ?? null,
    draft: (row.draft && typeof row.draft === 'object' ? row.draft : {}) as Record<string, string>,
    handover_until: (row.handover_until as string | null) ?? null,
  };
}

async function saveUser(userId: string, patch: UserPatch) {
  if (Object.keys(patch).length === 0) return;
  const { error } = await db.from('line_users').update(patch as Record<string, unknown>).eq('line_user_id', userId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ what the bot can look up / do */
async function ports(user: LineUserRow, linked: Linked | null, token: string): Promise<BotPorts> {
  const { data: s, error } = await db.from('settings')
    .select('dorm_name, office_hours, office_phone, location_lat, location_lng, summary_line_user_id').eq('id', 1).single();
  if (error) throw error;

  return {
    now: Date.now(),
    today: bangkokToday(),
    dormName: String(s.dorm_name ?? ''),
    linkedRoom: linked?.room ?? null,

    async info(key) {
      const { data, error } = await db.from('line_info').select('text_th, text_en').eq('key', key).maybeSingle();
      if (error) throw error;
      return { th: String(data?.text_th ?? ''), en: String(data?.text_en ?? '') };
    },
    contact: async () => ({ hours: String(s.office_hours ?? ''), phone: String(s.office_phone ?? '') }),
    location: async () =>
      s.location_lat != null && s.location_lng != null ? { lat: Number(s.location_lat), lng: Number(s.location_lng) } : null,
    async vacancy() {
      const { data, error } = await db.from('rooms').select('default_rent').eq('status', 'vacant');
      if (error) throw error;
      const rents = (data ?? []).map((r) => Number(r.default_rent)).filter((n) => n > 0);
      return { count: data?.length ?? 0, minRent: rents.length ? Math.min(...rents) : null, maxRent: rents.length ? Math.max(...rents) : null };
    },
    requestLink: (room) => requestLink(user.line_user_id, room, linked?.room ?? null, token),
    async createViewing(r) {
      // A viewing appointment, NOT a reservation: no room is held. Staff confirm the time in the app.
      const { error } = await db.from('viewings').insert({
        guest_name: r.name, phone: r.phone, line_user_id: user.line_user_id, visit_date: r.date, time_of_day: r.slot,
        status: 'requested', source: 'line', note: user.display_name ? `LINE: ${user.display_name}` : 'LINE',
      });
      if (error) throw error;
    },
    async notifyOwner() {
      const to = s.summary_line_user_id as string | null;
      if (!to) return;
      try {
        await push(token, to, [text(ownerNotice(user.display_name || '?', linked?.room ?? null))]);
      } catch (e) {
        console.error('line-webhook: owner notice failed:', e instanceof Error ? e.message : String(e));
      }
    },
  };
}

/* ------------------------------------------------------------------ room linking (unchanged rules) */
/** Same rules as before: unknown room -> nothing created; one pending request per LINE user
 *  (typing again updates it); staff approve in the app. */
async function requestLink(userId: string, room: string, linkedRoom: string | null, token: string): Promise<'waiting' | 'not_found' | 'already_linked'> {
  const { data: found, error: roomErr } = await db.from('rooms').select('id, number').eq('number', room).maybeSingle();
  if (roomErr) throw roomErr;
  if (!found) return 'not_found';
  if (linkedRoom === found.number) return 'already_linked';

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
  return 'waiting';
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
async function handlePayButton(userId: string, data: string | undefined, answerWith: (m: LineMessage[]) => Promise<void>, lang: Lang | null) {
  const choice = parsePayPostback(data);
  if (!choice) return;
  const R = lang ? PAY_REPLY_1[lang] : PAY_REPLY;
  const [x] = await loadBills(db, { ids: [choice.billId] });
  // Only the tenant the bill belongs to gets its payment details.
  if (!x || !x.tenant?.line_user_id || x.tenant.line_user_id !== userId) {
    await answerWith([text(R.notYours)]);
    return;
  }
  const balance = Number(x.bill.balance);
  if (balance <= 0) { await answerWith([text(R.paid)]); return; }

  const { error } = await db.from('bills')
    .update({ pay_method_chosen: choice.method, pay_method_chosen_at: new Date().toISOString() }).eq('id', x.bill.id);
  if (error) console.error('line-webhook: could not save the payment choice:', error.message);

  const s = await loadSettings(db);
  const room = x.bill.room_number;
  // "Not set up" keeps the buttons, so the tenant can pick another way.
  const notReady = () => answerWith([textWithButtons(R.notReady, payButtons(x.bill.id, null, lang))]);

  if (choice.method === 'promptpay') {
    if (!promptPayKind(s.promptpay_id)) { await notReady(); return; }
    const url = await promptPayImageUrl(x.bill.id, s.promptpay_id, balance);
    await answerWith([text(R.promptpay(room, balance)), image(url)]);
    return;
  }
  const msg = choice.method === 'transfer' ? R.transfer(room, balance, s) : R.cash(room, balance, s);
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
async function saveSlip(userId: string, linked: Linked, messageId: string, token: string, lang: Lang | null): Promise<string> {
  const R = lang ? SLIP_REPLY_1[lang] : SLIP_REPLY;
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
  if (!first.error) return R.received;
  if (first.error.code !== '23505') throw first.error;
  if (first.error.message.includes('line_message_id')) return R.received;   // LINE delivered the same image twice

  // Same QR reference as an earlier slip: keep it, flagged as a duplicate of that one.
  const { data: orig } = await db.from('payment_slips').select('id').eq('slip_ref', ref!).maybeSingle();
  const dup = await db.from('payment_slips').insert({ ...row, slip_ref: null, duplicate_of: orig?.id ?? null });
  if (dup.error && dup.error.code !== '23505') throw dup.error;
  return R.duplicate;
}

