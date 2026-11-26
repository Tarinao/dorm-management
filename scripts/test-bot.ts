/* Tests for the LINE OA conversation (supabase/functions/_shared/bot.ts) with fake database/LINE.
 * Covers: follow -> language -> menu, one language afterwards, handover silence, the "menu"
 * keyword, linked vs unlinked menus, dorm info from Settings, booking, and that payment buttons
 * are left to the webhook. Run: npm run test:bot */
import {
  HANDOVER_HOURS, INFO_ANSWERS, INFO_KEYS, parseBotPostback, LANG_BUTTONS, TEXT, botData, botReply, infoMenuItems, mainMenuItems, parsePhone, parseVisitDate,
  type BotEvent, type BotMessage, type BotPorts, type BotReply, type BotUser, type Lang,
} from '../supabase/functions/_shared/bot.ts';
import { PAY_BUTTON_1 } from '../supabase/functions/_shared/lang.ts';
import { AREAS, renderRichMenu, richMenuBody } from './line-rich-menu.ts';
import { readFileSync } from 'node:fs';
import { payPostback } from '../supabase/functions/_shared/core.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`); }
}
function eq<T>(actual: T, expected: T, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: unknown, what: string) { if (!cond) throw new Error(what); }

// Thai letters (the baht sign ฿ sits in the Thai block too, but is used in both languages).
const THAI = /[ก-ฺเ-๛]/;
const LATIN = /[A-Za-z]/;
const NOW = Date.parse('2026-11-26T03:00:00Z');   // 10:00 Bangkok
const TODAY = '2026-11-26';

/* ---- a fake user + fake ports that remember what the bot did */
type Fake = {
  user: BotUser; linkedRoom: string | null; now: number;
  links: string[]; viewings: { name: string; phone: string; date: string; slot: string }[]; notices: number;
  info: Record<string, { th: string; en: string }>;
};
function fake(over: Partial<Fake> = {}): Fake {
  return {
    user: { lang: null, menu_state: null, draft: {}, handover_until: null },
    linkedRoom: null, now: NOW, links: [], viewings: [], notices: 0,
    // Settings values without Latin letters in Thai / Thai letters in English, so "one language" is checkable.
    info: {
      room_types: { th: 'ห้องพัดลม 3,500 บาท ห้องแอร์ 4,500 บาท', en: 'Fan room 3,500 baht, air-con room 4,500 baht' },
      facilities: { th: 'ที่จอดรถ เครื่องซักผ้า', en: 'Parking, washing machines' },
      location: { th: '123 ถนนสุขุมวิท กรุงเทพฯ', en: '123 Sukhumvit Road, Bangkok' },
      house_rules: { th: '', en: '' },                                   // empty on purpose
      deposit_terms: { th: 'เงินประกัน 2 เดือน สัญญา 6 เดือน', en: 'Deposit 2 months, contract 6 months' },
    },
    ...over,
  };
}
function portsOf(f: Fake): BotPorts {
  return {
    now: f.now, today: TODAY, dormName: '', linkedRoom: f.linkedRoom,
    info: async (k) => f.info[k],
    contact: async () => ({ hours: '08:00–18:00', phone: '081-234-5678' }),
    location: async () => ({ lat: 13.7563, lng: 100.5018 }),
    vacancy: async () => ({ count: 3, minRent: 3500, maxRent: 4500 }),
    requestLink: async (room) => { if (room === '999') return 'not_found'; f.links.push(room); return f.linkedRoom === room ? 'already_linked' : 'waiting'; },
    createViewing: async (r) => { f.viewings.push(r); },
    notifyOwner: async () => { f.notices++; },
  };
}
/** Send one event; apply the patch to the fake user like the webhook does. */
async function send(f: Fake, ev: BotEvent): Promise<BotReply | null> {
  const r = await botReply(ev, f.user, portsOf(f));
  if (r) {
    const { wants_talk_at: _w, ...patch } = r.patch;
    f.user = { ...f.user, ...patch };
  }
  return r;
}
const say = (text: string): BotEvent => ({ kind: 'text', text });
const tap = (data: string): BotEvent => ({ kind: 'postback', data });
const texts = (r: BotReply | null) => (r?.messages ?? []).map((m) => (m.type === 'text' ? m.text : `${m.title} ${m.address}`));
const labels = (m: BotMessage | undefined) => (m && m.type === 'text' ? m.quickReply?.items.map((i) => i.action.label) ?? [] : []);
const datas = (m: BotMessage | undefined) => (m && m.type === 'text' ? m.quickReply?.items.map((i) => i.action.data) ?? [] : []);
const last = (r: BotReply | null) => r?.messages[r.messages.length - 1];

/** Every text (and quick-reply label) is only in `lang`. */
function onlyLang(r: BotReply | null, lang: Lang, what: string) {
  for (const m of r?.messages ?? []) {
    const parts = m.type === 'text' ? [m.text, ...labels(m)] : [m.title, m.address];
    for (const p of parts) {
      // 'LINE OA' never appears in bot texts; "เมนู" / "menu" are the keywords themselves.
      const clean = lang === 'th' ? p.replace(/"menu"/g, '') : p.replace(/"เมนู"/g, '');
      if (lang === 'th') ok(!LATIN.test(clean), `${what}: English in a Thai message: ${JSON.stringify(p)}`);
      else ok(!THAI.test(clean), `${what}: Thai in an English message: ${JSON.stringify(p)}`);
    }
  }
}

console.log('Follow -> language -> menu');
await test('follow: one warm welcome in BOTH languages with [ภาษาไทย] [English]', async () => {
  const f = fake();
  const r = await send(f, { kind: 'follow' });
  eq(r!.messages.length, 1);
  const t = texts(r)[0];
  ok(THAI.test(t) && /welcome/i.test(t), 'welcome is Thai + English');
  eq(labels(r!.messages[0]), ['ภาษาไทย', 'English']);
});
for (const lang of ['th', 'en'] as const) {
  await test(`choosing ${lang} saves it and shows the main menu in ${lang} only`, async () => {
    const f = fake();
    await send(f, { kind: 'follow' });
    const r = await send(f, tap(LANG_BUTTONS[lang === 'th' ? 0 : 1].data));
    eq(f.user.lang, lang, 'saved language');
    eq(labels(last(r)), mainMenuItems(lang, false).map((i) => i.label));
    onlyLang(r, lang, 'menu');
  });
  await test(`every later message is ${lang} only (info, vacancy, location, booking, contact, not understood)`, async () => {
    const f = fake();
    await send(f, { kind: 'follow' });
    await send(f, tap(botData('lang', { v: lang })));
    onlyLang(await send(f, tap(botData('info'))), lang, 'info menu');
    for (const k of INFO_ANSWERS) onlyLang(await send(f, tap(botData('info', { k }))), lang, `info ${k}`);
    onlyLang(await send(f, say('blah blah')), lang, 'not understood');
    onlyLang(await send(f, tap(botData('connect'))), lang, 'connect');
    onlyLang(await send(f, say('abc')), lang, 'connect: bad room');
    onlyLang(await send(f, say('101')), lang, 'connect: waiting');
    onlyLang(await send(f, tap(botData('book'))), lang, 'book');
    onlyLang(await send(f, say('สมชาย Smith')), lang === 'th' ? 'th' : 'en', 'book: phone question');
    onlyLang(await send(f, say('0812345678')), lang, 'book: date question');
    onlyLang(await send(f, say('15/12')), lang, 'book: time question');
    onlyLang(await send(f, say('??')), lang, 'book: time not understood');
    const done = await send(f, tap(botData('slot', { k: 'afternoon' })));
    ok(texts(done)[0].includes('15/12/'), 'booking confirmation shows the date');
    ok(texts(done)[0].toLowerCase().includes(TEXT[lang].btn.afternoon.toLowerCase()), 'booking confirmation shows the time of day');
    // The name the guest typed is echoed back; check the rest of the message.
    onlyLang({ messages: [{ type: 'text', text: texts(done)[0].replace('สมชาย Smith', '') }], patch: {} }, lang, 'booked');
    onlyLang(await send(f, tap(botData('contact'))), lang, 'contact');
  });
}
await test('before a language is chosen, anything except a room number asks for the language again', async () => {
  const f = fake();
  const r = await send(f, say('hello'));
  eq(labels(r!.messages[0]), ['ภาษาไทย', 'English']);
  const r2 = await send(f, tap(botData('info')));
  eq(labels(r2!.messages[0]), ['ภาษาไทย', 'English']);
});
await test('"Language" in the menu lets the user switch', async () => {
  const f = fake({ user: { lang: 'th', menu_state: null, draft: {}, handover_until: null } });
  const r = await send(f, tap(botData('langpick')));
  eq(labels(r!.messages[0]), ['ภาษาไทย', 'English']);
  await send(f, tap(botData('lang', { v: 'en' })));
  eq(f.user.lang, 'en');
});

console.log('Linked vs not linked');
await test('not linked: main menu has "Connect my room"', () => {
  eq(mainMenuItems('th', false).map((i) => i.label), ['ข้อมูลหอพัก', 'เชื่อมต่อห้องของฉัน', 'ติดต่อเจ้าหน้าที่', 'เปลี่ยนภาษา']);
  eq(mainMenuItems('en', false).map((i) => i.label), ['Dorm information', 'Connect my room', 'Contact staff', 'Language']);
});
await test('linked tenant: same menu without "Connect my room"', async () => {
  const f = fake({ linkedRoom: '101', user: { lang: 'en', menu_state: null, draft: {}, handover_until: null } });
  const r = await send(f, say('menu'));
  eq(labels(r!.messages[0]), ['Dorm information', 'Contact staff', 'Language']);
});
await test('linked tenant tapping an old "Connect my room" button: told they are connected, no request', async () => {
  const f = fake({ linkedRoom: '101', user: { lang: 'th', menu_state: null, draft: {}, handover_until: null } });
  const r = await send(f, tap(botData('connect')));
  ok(texts(r)[0].includes('101'), 'mentions the room');
  eq(f.links, []);
  ok(!labels(r!.messages[0]).includes('เชื่อมต่อห้องของฉัน'), 'menu has no connect');
});
await test('Connect my room -> room number -> one pending request (staff approve)', async () => {
  const f = fake({ user: { lang: 'th', menu_state: null, draft: {}, handover_until: null } });
  await send(f, tap(botData('connect')));
  eq(f.user.menu_state, 'ask_room');
  await send(f, say('ห้อง 999'));
  eq(f.user.menu_state, 'ask_room', 'unknown room: asked again');
  const r = await send(f, say('ห้อง 204'));
  eq(f.links, ['204']);
  eq(f.user.menu_state, null);
  ok(texts(r)[0].includes('รอเจ้าหน้าที่ยืนยัน'), 'waiting for staff');
});
await test('existing flow kept: a room number typed without the menu still makes a request (bilingual if no language)', async () => {
  const f = fake();
  const r = await send(f, say('101'));
  eq(f.links, ['101']);
  ok(THAI.test(texts(r)[0]) && /Waiting for staff/.test(texts(r)[0]), 'original bilingual "waiting" text');
});

console.log('Contact staff and handover');
await test('Contact staff: hours + phone, wants-to-talk, ONE owner notice, 12 hours of silence', async () => {
  const f = fake({ user: { lang: 'th', menu_state: null, draft: {}, handover_until: null } });
  const r = await botReply(tap(botData('contact')), f.user, portsOf(f));
  ok(texts(r)[0].includes('08:00–18:00') && texts(r)[0].includes('081-234-5678'), 'office hours and phone');
  eq(f.notices, 1, 'owner notified');
  eq(r!.patch.wants_talk_at, new Date(NOW).toISOString(), 'wants to talk');
  eq(r!.patch.handover_until, new Date(NOW + HANDOVER_HOURS * 3600_000).toISOString(), 'handover 12h');
  f.user = { ...f.user, handover_until: r!.patch.handover_until! };

  for (const t of ['สวัสดีค่ะ', 'มีห้องว่างไหม', 'hello?']) {
    const quiet = await send(f, say(t));
    eq(quiet!.messages.length, 0, `silent for "${t}"`);
  }
  eq((await send(f, { kind: 'other' }))!.messages.length, 0, 'silent for a sticker');
  const again = await botReply(tap(botData('contact')), f.user, portsOf(f));
  eq(f.notices, 1, 'tapping Contact again during handover: no second notice');
  ok(again!.messages.length === 1, 'but still answers the tap');
});
await test('typing a room number during handover does not interrupt staff', async () => {
  const f = fake({ user: { lang: 'th', menu_state: null, draft: {}, handover_until: new Date(NOW + 3600_000).toISOString() } });
  eq((await send(f, say('101')))!.messages.length, 0);
  eq(f.links, []);
});
for (const kw of ['เมนู', 'menu', 'MENU ', 'เริ่มใหม่', 'start', 'Start']) {
  await test(`"${kw}" brings the menu back during handover and ends it`, async () => {
    const f = fake({ user: { lang: 'en', menu_state: null, draft: {}, handover_until: new Date(NOW + 3600_000).toISOString() } });
    const r = await send(f, say(kw));
    eq(labels(r!.messages[0]), mainMenuItems('en', false).map((i) => i.label));
    eq(f.user.handover_until, null);
    const after = await send(f, say('what?'));
    ok(texts(after)[0] === TEXT.en.notUnderstood, 'bot answers again afterwards');
  });
}
await test('handover ends by itself after 12 hours', async () => {
  const f = fake({ now: NOW + 13 * 3600_000, user: { lang: 'th', menu_state: null, draft: {}, handover_until: new Date(NOW + 12 * 3600_000).toISOString() } });
  eq(texts(await send(f, say('hello')))[0], TEXT.th.notUnderstood);
});
await test('"menu" also cancels a half-finished booking', async () => {
  const f = fake({ user: { lang: 'th', menu_state: 'book_phone', draft: { name: 'นก' }, handover_until: null } });
  await send(f, say('เมนู'));
  eq([f.user.menu_state, f.user.draft], [null, {}]);
});

console.log('Not understood, dorm information, booking');
await test('unknown text: short "didn\'t understand" + main menu', async () => {
  const f = fake({ user: { lang: 'th', menu_state: null, draft: {}, handover_until: null } });
  const r = await send(f, say('ขอเบอร์ไลน์หน่อย'));
  eq(texts(r), [TEXT.th.notUnderstood]);
  eq(labels(r!.messages[0]), mainMenuItems('th', false).map((i) => i.label));
});
await test('info answers come from Settings and end with [Back to menu] [Contact staff]', async () => {
  const f = fake({ user: { lang: 'en', menu_state: null, draft: {}, handover_until: null } });
  const r = await send(f, tap(botData('info', { k: 'room_types' })));
  eq(texts(r), ['Fan room 3,500 baht, air-con room 4,500 baht']);
  eq(labels(last(r)), ['Back to menu', 'Contact staff']);
  const empty = await send(f, tap(botData('info', { k: 'house_rules' })));
  eq(texts(empty), [TEXT.en.infoMissing], 'empty text -> "not available yet"');
});
await test('available rooms: live count and rent range', async () => {
  const f = fake({ user: { lang: 'th', menu_state: null, draft: {}, handover_until: null } });
  const t = texts(await send(f, tap(botData('info', { k: 'available' }))))[0];
  ok(t.includes('3 ห้อง') && t.includes('฿3,500.00') && t.includes('฿4,500.00'), t);
});
await test('location: a LINE location message, then the address text', async () => {
  const f = fake({ user: { lang: 'en', menu_state: null, draft: {}, handover_until: null } });
  const r = await send(f, tap(botData('info', { k: 'location' })));
  eq(r!.messages[0].type, 'location');
  const loc = r!.messages[0] as Extract<BotMessage, { type: 'location' }>;
  eq([loc.latitude, loc.longitude, loc.address], [13.7563, 100.5018, '123 Sukhumvit Road, Bangkok']);
  eq(labels(last(r)), ['Back to menu', 'Contact staff']);
});
await test('booking a viewing: name -> phone -> date -> time of day -> ONE viewing (not a reservation)', async () => {
  const f = fake({ user: { lang: 'th', menu_state: null, draft: {}, handover_until: null } });
  await send(f, tap(botData('book')));
  await send(f, say('x'));                         eq(f.user.menu_state, 'book_name', 'too short');
  await send(f, say('นก ใจดี'));                    eq(f.user.menu_state, 'book_phone');
  await send(f, say('12345'));                     eq(f.user.menu_state, 'book_phone', 'bad phone');
  await send(f, say('081-234-5678'));              eq(f.user.menu_state, 'book_date');
  await send(f, say('1/1/2500'));                  eq(f.user.menu_state, 'book_date', 'date in the past');
  await send(f, say('20/12/2569'));                eq(f.user.menu_state, 'book_time');
  const ask = await send(f, say('พรุ่งนี้'));
  eq(f.user.menu_state, 'book_time', 'not a time of day');
  eq(labels(last(ask)), ['ช่วงเช้า', 'ช่วงบ่าย', 'ช่วงเย็น', 'ยกเลิก']);
  eq(f.viewings, [], 'nothing saved yet');
  await send(f, tap(botData('slot', { k: 'morning' })));
  eq(f.viewings, [{ name: 'นก ใจดี', phone: '0812345678', date: '2026-12-20', slot: 'morning' }]);
  eq([f.user.menu_state, f.user.draft], [null, {}]);
});
await test('a typed time of day also works ("บ่าย", "evening")', async () => {
  const draft = { name: 'Nok', phone: '0812345678', date: '2026-12-20' };
  const th = fake({ user: { lang: 'th', menu_state: 'book_time', draft, handover_until: null } });
  await send(th, say('ช่วงบ่ายค่ะ'));
  eq(th.viewings.map((v) => v.slot), ['afternoon']);
  const en = fake({ user: { lang: 'en', menu_state: 'book_time', draft, handover_until: null } });
  await send(en, say('Evening please'));
  eq(en.viewings.map((v) => v.slot), ['evening']);
});
await test('a time button tapped outside the viewing questions saves nothing and shows the menu', async () => {
  const f = fake({ user: { lang: 'en', menu_state: null, draft: {}, handover_until: null } });
  const r = await send(f, tap(botData('slot', { k: 'morning' })));
  eq(f.viewings, []);
  eq(labels(last(r)), mainMenuItems('en', false).map((i) => i.label));
});
await test('booking answers are processed even during handover (the user started them)', async () => {
  const f = fake({ user: { lang: 'en', menu_state: 'book_name', draft: {}, handover_until: new Date(NOW + 3600_000).toISOString() } });
  const r = await send(f, say('Nok Jaidee'));
  eq(texts(r), [TEXT.en.bookPhone]);
});
await test('Cancel during a question goes back to the menu', async () => {
  const f = fake({ user: { lang: 'en', menu_state: 'ask_room', draft: {}, handover_until: null } });
  await send(f, tap(botData('cancel')));
  eq(f.user.menu_state, null);
});

console.log('Payment buttons and slips stay with the webhook');
await test('a payment-button postback is NOT handled by the bot (webhook keeps the old logic)', async () => {
  const f = fake({ linkedRoom: '101', user: { lang: 'th', menu_state: null, draft: {}, handover_until: new Date(NOW + 3600_000).toISOString() } });
  eq(await send(f, tap(payPostback('promptpay', '0b5b7e8e-1111-4222-8333-944445555666'))), null);
});
await test('payment-button labels in both languages are at most 20 characters', () => {
  for (const lang of ['th', 'en'] as const) for (const l of Object.values(PAY_BUTTON_1[lang])) ok(l.length <= 20, l);
});

console.log('LINE limits and parsing');
await test('every quick-reply label is 1–20 characters, at most 13 per message', () => {
  for (const lang of ['th', 'en'] as const) {
    const all = [...mainMenuItems(lang, false), ...infoMenuItems(lang), ...LANG_BUTTONS, ...Object.values(TEXT[lang].btn).map((label) => ({ label }))];
    for (const i of all) ok(i.label.length >= 1 && i.label.length <= 20, `${lang}: "${i.label}" is ${i.label.length} characters`);
    ok(infoMenuItems(lang).length <= 13, 'too many quick replies');
  }
});
await test('postback data stays short (LINE max 300)', () => {
  for (const i of [...infoMenuItems('th'), ...mainMenuItems('th', false), ...LANG_BUTTONS]) ok(i.data.length <= 300, i.data);
});
await test('phone numbers', () => {
  eq(parsePhone('081-234-5678'), '0812345678');
  eq(parsePhone('+66 81 234 5678'), '0812345678');
  eq(parsePhone('๐๘๑๒๓๔๕๖๗๘'), '0812345678');
  eq(parsePhone('021234567'), '021234567');
  eq(parsePhone('12345'), null);
  eq(parsePhone('hello'), null);
});
await test('visit dates: Buddhist / AD years, no year, ISO; not in the past, within a year', () => {
  eq(parseVisitDate('15/12/2569', TODAY), '2026-12-15');
  eq(parseVisitDate('15/12/2026', TODAY), '2026-12-15');
  eq(parseVisitDate('15-12-69', TODAY), '2026-12-15');
  eq(parseVisitDate('๑๕/๑๒/๒๕๖๙', TODAY), '2026-12-15');
  eq(parseVisitDate('5/1', TODAY), '2027-01-05', 'no year, already passed this year -> next year');
  eq(parseVisitDate('26/11', TODAY), '2026-11-26', 'today is fine');
  eq(parseVisitDate('2026-12-01', TODAY), '2026-12-01');
  eq(parseVisitDate('25/11/2026', TODAY), null, 'yesterday');
  eq(parseVisitDate('31/02/2027', TODAY), null, 'no such day');
  eq(parseVisitDate('1/1/2028', TODAY), null, 'more than a year away');
  eq(parseVisitDate('tomorrow', TODAY), null);
});

console.log('Rich menu and Settings');
await test('rich menu: 4 areas side by side covering 2500 x 843, each a postback the bot understands', async () => {
  const body = richMenuBody();
  eq(body.size, { width: 2500, height: 843 });
  eq(body.areas.reduce((w, a) => w + a.bounds.width, 0), 2500);
  ok(body.chatBarText.length <= 14, 'chat bar text max 14 characters');
  for (const a of body.areas) ok(parseBotPostback(a.action.data) !== null, a.action.data);
  // Tapping each one gives an answer (linked tenant: "Connect my room" says they are connected).
  for (const linkedRoom of [null, '101']) {
    for (const a of AREAS) {
      const f = fake({ linkedRoom, user: { lang: 'en', menu_state: null, draft: {}, handover_until: null } });
      ok((await send(f, tap(a.data)))!.messages.length > 0, `${a.key} answers`);
    }
  }
});
await test('rich menu picture: a 2500 x 843 PNG under 1 MB', () => {
  const png = renderRichMenu();
  eq([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  eq([png.readUInt32BE(16), png.readUInt32BE(20)], [2500, 843]);
  ok(png.length < 1024 * 1024, `${png.length} bytes`);
});
await test('dorm-info keys are the same in the bot, the Settings page and the database', () => {
  const settings = readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20261126101711_line_bot.sql', import.meta.url), 'utf8');
  const list = INFO_KEYS.map((k) => `'${k}'`).join(', ');
  ok(settings.includes(`const INFO_KEYS = [${list}] as const;`), 'Settings.tsx INFO_KEYS');
  ok(migration.includes(`check (key in (${list}))`), 'line_info check constraint');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
