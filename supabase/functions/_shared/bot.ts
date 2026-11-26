/* The LINE OA conversation: welcome -> language -> main menu -> dorm information / connect my
 * room / contact staff / book a viewing (a viewing appointment, NOT a reservation).
 *
 * botReply() decides WHAT to answer and how the user's row in line_users changes. It does no I/O
 * itself: everything it needs from the database or LINE comes through `ports`, so the whole flow
 * is tested in scripts/test-bot.ts with fakes. The line-webhook function supplies the real ports.
 *
 * Not handled here (the webhook keeps doing them exactly as before): payment-button postbacks
 * ("pay=..."), and slip photos from linked tenants. botReply returns null for anything that is
 * not for the bot.
 *
 * Rules:
 *   - follow: warm welcome in Thai AND English + [ภาษาไทย] [English]. After the choice, every
 *     bot message uses ONLY that language.
 *   - "เมนู", "menu", "เริ่มใหม่", "start" always show the main menu (also during handover).
 *   - Contact staff: office hours + phone, "Wants to talk" in the app, one notice to the owner,
 *     then the bot stays quiet for that user for 12 hours (handover).
 *   - Text the bot does not understand: a short "I didn't understand" + the main menu, except
 *     during handover (silence, staff are chatting).
 *   - A room number typed outside any menu still makes a link request (the way tenants were told
 *     to connect before the menu existed), so the existing linking keeps working.
 *   - All answers are REPLY messages (free). Quick-reply labels are at most 20 characters. */
import { MSG, baht, dmy, parseRoomNumber } from './core.ts';
import { LINK_1, type Lang } from './lang.ts';

export type { Lang } from './lang.ts';
export type MenuState = 'ask_room' | 'book_name' | 'book_phone' | 'book_date' | 'book_time';
export const MENU_STATES: readonly MenuState[] = ['ask_room', 'book_name', 'book_phone', 'book_date', 'book_time'];

/** When the guest would like to come; staff agree the exact time when they call back. */
export const SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type Slot = typeof SLOTS[number];

export interface BotUser {
  lang: Lang | null;
  menu_state: MenuState | null;
  draft: Record<string, string>;
  handover_until: string | null;    // ISO timestamp
}
export type UserPatch = Partial<BotUser> & { wants_talk_at?: string };

export type BotEvent =
  | { kind: 'follow' }
  | { kind: 'text'; text: string }
  | { kind: 'postback'; data: string }
  | { kind: 'other' };              // sticker, photo from someone not linked, ...

export const INFO_KEYS = ['room_types', 'facilities', 'location', 'house_rules', 'deposit_terms'] as const;
export type InfoKey = typeof INFO_KEYS[number];

export interface BotPorts {
  now: number;                      // ms since epoch
  today: string;                    // Bangkok date 'YYYY-MM-DD'
  dormName: string;
  linkedRoom: string | null;        // room of the tenant this LINE user is linked to
  info(key: InfoKey): Promise<{ th: string; en: string }>;
  contact(): Promise<{ hours: string; phone: string }>;
  location(): Promise<{ lat: number; lng: number } | null>;
  vacancy(): Promise<{ count: number; minRent: number | null; maxRent: number | null }>;
  requestLink(room: string): Promise<'waiting' | 'not_found' | 'already_linked'>;
  createViewing(r: { name: string; phone: string; date: string; slot: Slot }): Promise<void>;
  notifyOwner(): Promise<void>;
}

export type QuickItem = { label: string; data: string; said: string };
export type BotMessage =
  | { type: 'text'; text: string; quickReply?: { items: { type: 'action'; action: { type: 'postback'; label: string; data: string; displayText: string } }[] } }
  | { type: 'location'; title: string; address: string; latitude: number; longitude: number };

export interface BotReply { messages: BotMessage[]; patch: UserPatch }

export const HANDOVER_HOURS = 12;
const KEYWORDS = ['เมนู', 'menu', 'เริ่มใหม่', 'start'];
export const isMenuKeyword = (t: string | null | undefined) => KEYWORDS.includes(String(t ?? '').trim().toLowerCase());

/* ------------------------------------------------------------------ postback data */
export type BotAction = 'menu' | 'lang' | 'langpick' | 'info' | 'connect' | 'contact' | 'book' | 'slot' | 'cancel';
const ACTIONS: readonly BotAction[] = ['menu', 'lang', 'langpick', 'info', 'connect', 'contact', 'book', 'slot', 'cancel'];
export const INFO_ANSWERS = ['room_types', 'available', 'facilities', 'location', 'house_rules', 'deposit_terms'] as const;
export type InfoAnswer = typeof INFO_ANSWERS[number];

export const botData = (action: BotAction, extra: Record<string, string> = {}) =>
  new URLSearchParams({ bot: action, ...extra }).toString();

export function parseBotPostback(data: string | null | undefined): { action: BotAction; v?: string; k?: string } | null {
  const p = new URLSearchParams(String(data ?? ''));
  const action = ACTIONS.find((a) => a === p.get('bot'));
  if (!action) return null;
  return { action, v: p.get('v') ?? undefined, k: p.get('k') ?? undefined };
}

/* ------------------------------------------------------------------ texts (one language each) */
type Texts = {
  langSet: string; menuIntro: string; notUnderstood: string;
  btn: { info: string; connect: string; contact: string; language: string; back: string; cancel: string;
         room_types: string; available: string; facilities: string; location: string; house_rules: string;
         deposit_terms: string; book: string; morning: string; afternoon: string; evening: string };
  infoIntro: string; infoMissing: string;
  vacancy: (n: number, min: number | null, max: number | null) => string; noVacancy: string;
  askRoom: string; notRoom: string; alreadyLinked: (r: string) => string;
  contact: (hours: string, phone: string) => string;
  bookName: string; bookNameBad: string; bookPhone: string; bookPhoneBad: string;
  bookDate: string; bookDateBad: string; bookTime: string; bookTimeBad: string;
  booked: (name: string, date: string, slot: string) => string;
};

export const TEXT: Record<Lang, Texts> = {
  th: {
    langSet: 'เลือกภาษาไทยแล้วค่ะ',
    menuIntro: 'มีอะไรให้ช่วยคะ เลือกเมนูด้านล่างได้เลยค่ะ',
    notUnderstood: 'ขออภัยค่ะ ไม่เข้าใจข้อความนี้ กรุณาเลือกจากเมนูด้านล่าง',
    btn: {
      info: 'ข้อมูลหอพัก', connect: 'เชื่อมต่อห้องของฉัน', contact: 'ติดต่อเจ้าหน้าที่', language: 'เปลี่ยนภาษา',
      back: 'กลับเมนูหลัก', cancel: 'ยกเลิก',
      room_types: 'ประเภทห้องและราคา', available: 'ห้องว่างตอนนี้', facilities: 'สิ่งอำนวยความสะดวก',
      location: 'ที่ตั้งและแผนที่', house_rules: 'กฎของหอพัก', deposit_terms: 'เงินประกันและสัญญา', book: 'นัดดูห้อง',
      morning: 'ช่วงเช้า', afternoon: 'ช่วงบ่าย', evening: 'ช่วงเย็น',
    },
    infoIntro: 'อยากทราบข้อมูลเรื่องไหนคะ',
    infoMissing: 'ขออภัยค่ะ ยังไม่มีข้อมูลเรื่องนี้ กรุณาติดต่อเจ้าหน้าที่',
    vacancy: (n, min, max) => `ตอนนี้มีห้องว่าง ${n} ห้อง` +
      (min !== null && max !== null ? (min === max ? `\nค่าเช่า ${baht(min)} ต่อเดือน` : `\nค่าเช่า ${baht(min)} – ${baht(max)} ต่อเดือน`) : ''),
    noVacancy: 'ตอนนี้ห้องเต็มทุกห้องค่ะ แต่ยังนัดเข้ามาดูห้องได้',
    askRoom: 'กรุณาพิมพ์เลขห้องของคุณ เช่น 101',
    notRoom: 'กรุณาพิมพ์เฉพาะเลขห้อง เช่น 101',
    alreadyLinked: (r) => `บัญชีนี้เชื่อมต่อกับห้อง ${r} อยู่แล้วค่ะ`,
    contact: (hours, phone) => [
      'ได้เลยค่ะ เจ้าหน้าที่จะตอบกลับในแชทนี้โดยเร็วที่สุด',
      ...(hours ? [`เวลาทำการ: ${hours}`] : []),
      ...(phone ? [`โทร: ${phone}`] : []),
      '',
      `ระหว่างนี้ระบบตอบกลับอัตโนมัติจะหยุดตอบ ${HANDOVER_HOURS} ชั่วโมง พิมพ์ "เมนู" เพื่อกลับมาที่เมนูได้ทุกเมื่อ`,
    ].join('\n'),
    bookName: 'ยินดีค่ะ กรุณาพิมพ์ชื่อ-นามสกุลของคุณ',
    bookNameBad: 'กรุณาพิมพ์ชื่อ-นามสกุล (2–100 ตัวอักษร)',
    bookPhone: 'กรุณาพิมพ์เบอร์โทรศัพท์ที่ติดต่อได้ เช่น 0812345678',
    bookPhoneBad: 'เบอร์โทรไม่ถูกต้อง กรุณาพิมพ์ใหม่ เช่น 0812345678',
    bookDate: 'อยากเข้ามาดูห้องวันไหนคะ พิมพ์วันที่ เช่น 15/12/2569',
    bookDateBad: 'วันที่ไม่ถูกต้อง กรุณาพิมพ์วันที่ภายใน 1 ปีนับจากวันนี้ เช่น 15/12/2569',
    bookTime: 'สะดวกช่วงเวลาไหนคะ',
    bookTimeBad: 'กรุณาเลือกช่วงเวลาจากปุ่มด้านล่างค่ะ',
    booked: (name, date, slot) => `ขอบคุณค่ะ คุณ${name}\nได้รับคำขอนัดดูห้องวันที่ ${date} ${slot} แล้ว\nเจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันเวลา (การนัดดูห้องยังไม่ใช่การจองห้อง)`,
  },
  en: {
    langSet: 'English selected.',
    menuIntro: 'How can we help? Please choose from the menu below.',
    notUnderstood: "Sorry, I didn't understand that. Please choose from the menu below.",
    btn: {
      info: 'Dorm information', connect: 'Connect my room', contact: 'Contact staff', language: 'Language',
      back: 'Back to menu', cancel: 'Cancel',
      room_types: 'Room types & prices', available: 'Available rooms', facilities: 'Facilities',
      location: 'Location', house_rules: 'House rules', deposit_terms: 'Deposit & contract', book: 'Book a viewing',
      morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
    },
    infoIntro: 'What would you like to know?',
    infoMissing: 'Sorry, this information is not available yet. Please contact staff.',
    vacancy: (n, min, max) => `${n} ${n === 1 ? 'room is' : 'rooms are'} available now` +
      (min !== null && max !== null ? (min === max ? `\nRent ${baht(min)} per month` : `\nRent ${baht(min)} – ${baht(max)} per month`) : ''),
    noVacancy: 'All rooms are taken right now, but you can still book a viewing.',
    askRoom: 'Please type your room number, e.g. 101',
    notRoom: 'Please type only the room number, e.g. 101',
    alreadyLinked: (r) => `This account is already connected to room ${r}.`,
    contact: (hours, phone) => [
      'Sure! A staff member will reply in this chat as soon as possible.',
      ...(hours ? [`Office hours: ${hours}`] : []),
      ...(phone ? [`Phone: ${phone}`] : []),
      '',
      `Meanwhile the automatic replies pause for ${HANDOVER_HOURS} hours. Type "menu" anytime to get the menu back.`,
    ].join('\n'),
    bookName: 'Happy to help! Please type your full name.',
    bookNameBad: 'Please type your full name (2–100 characters).',
    bookPhone: 'Please type a phone number we can call, e.g. 0812345678',
    bookPhoneBad: 'That phone number does not look right. Please type it again, e.g. 0812345678',
    bookDate: 'Which day would you like to come and see the room? Type a date, e.g. 15/12/2026',
    bookDateBad: 'That date does not look right. Please type a date within the next year, e.g. 15/12/2026',
    bookTime: 'What time of day suits you?',
    bookTimeBad: 'Please choose a time of day from the buttons below.',
    booked: (name, date, slot) => `Thank you, ${name}!\nWe received your viewing request for ${date}, ${slot.toLowerCase()}.\nStaff will contact you to confirm the time. A viewing does not reserve a room.`,
  },
};

/** Shown on follow and whenever no language was chosen yet: both languages. */
export function welcomeText(dormName: string): string {
  const name = dormName.trim();
  return [
    `สวัสดีค่ะ ยินดีต้อนรับสู่${name ? ` ${name}` : 'หอพักของเรา'} 🙏`,
    'ขอบคุณที่เพิ่มเราเป็นเพื่อนนะคะ',
    '',
    `Hello, and welcome to ${name || 'our dorm'}!`,
    'Thank you for adding us as a friend.',
    '',
    'กรุณาเลือกภาษา / Please choose your language',
  ].join('\n');
}
export const LANG_BUTTONS: QuickItem[] = [
  { label: 'ภาษาไทย', data: botData('lang', { v: 'th' }), said: 'ภาษาไทย' },
  { label: 'English', data: botData('lang', { v: 'en' }), said: 'English' },
];

/** The one notice pushed to the owner's summary account when someone asks for staff. */
export function ownerNotice(who: string, room: string | null): string {
  const th = room ? `ห้อง ${room} (${who})` : who;
  const en = room ? `Room ${room} (${who})` : who;
  return `💬 ${th} ต้องการคุยกับเจ้าหน้าที่ ตอบได้ใน LINE OA Manager\n${en} wants to talk to staff. Reply in LINE OA Manager.`;
}

/* ------------------------------------------------------------------ message builders */
export function textMsg(text: string, quick?: QuickItem[]): BotMessage {
  return quick && quick.length
    ? { type: 'text', text, quickReply: { items: quick.map((q) => ({ type: 'action', action: { type: 'postback', label: q.label, data: q.data, displayText: q.said } })) } }
    : { type: 'text', text };
}
const q = (label: string, action: BotAction, extra: Record<string, string> = {}): QuickItem => ({ label, data: botData(action, extra), said: label });

export function mainMenuItems(lang: Lang, linked: boolean): QuickItem[] {
  const b = TEXT[lang].btn;
  return [
    q(b.info, 'info'),
    ...(linked ? [] : [q(b.connect, 'connect')]),
    q(b.contact, 'contact'),
    q(b.language, 'langpick'),
  ];
}
export function infoMenuItems(lang: Lang): QuickItem[] {
  const b = TEXT[lang].btn;
  return [
    ...INFO_ANSWERS.map((k) => q(b[k], 'info', { k })),
    q(b.book, 'book'),
    q(b.back, 'menu'),
    q(b.contact, 'contact'),
  ];
}
const endItems = (lang: Lang) => [q(TEXT[lang].btn.back, 'menu'), q(TEXT[lang].btn.contact, 'contact')];
const cancelItems = (lang: Lang) => [q(TEXT[lang].btn.cancel, 'cancel')];
export const slotItems = (lang: Lang) => [...SLOTS.map((v) => q(TEXT[lang].btn[v], 'slot', { k: v })), ...cancelItems(lang)];

/* ------------------------------------------------------------------ input parsing */
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const arabic = (s: string) => s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));

/** "081-234-5678", "+66 81 234 5678" -> "0812345678"; null if it is not a Thai phone number. */
export function parsePhone(text: string): string | null {
  const s = arabic(text).replace(/[\s\-().]/g, '');
  const m = /^(?:\+?66|0)([0-9]{8,9})$/.exec(s);
  return m ? '0' + m[1] : null;
}

/** "15/12/2569", "15/12/2026", "15-12-69", "15/12", "2026-12-15" -> '2026-12-15'.
 *  Buddhist years are converted. Must be today or later, within a year. null otherwise. */
export function parseVisitDate(text: string, today: string): string | null {
  const s = arabic(text).trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmyM = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/.exec(s);
  const [ty, tm, td] = today.split('-').map(Number);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmyM) {
    d = Number(dmyM[1]); m = Number(dmyM[2]);
    if (dmyM[3] === undefined) {
      y = ty;
      if (m < tm || (m === tm && d < td)) y += 1;        // "15/01" in December = next January
    } else {
      y = Number(dmyM[3]);
      if (dmyM[3].length === 2) y = y >= 50 ? 2500 + y : 2000 + y;   // "69" = 2569, "26" = 2026
    }
  } else return null;
  if (y > 2400) y -= 543;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const out = date.toISOString().slice(0, 10);
  const max = new Date(Date.UTC(ty + 1, tm - 1, td)).toISOString().slice(0, 10);
  return out >= today && out <= max ? out : null;
}

/** A time of day typed instead of tapped: "เช้า", "บ่าย", "เย็น", "morning", ... */
export function parseSlot(text: string): Slot | null {
  const s = text.trim().toLowerCase();
  if (/เช้า|morning/.test(s)) return 'morning';
  if (/บ่าย|afternoon/.test(s)) return 'afternoon';
  if (/เย็น|ค่ำ|evening/.test(s)) return 'evening';
  return null;
}

/* ------------------------------------------------------------------ the conversation */
export const inHandover = (u: BotUser, now: number) => !!u.handover_until && Date.parse(u.handover_until) > now;

const idle = { menu_state: null, draft: {} } satisfies UserPatch;

function chooseLanguage(dormName: string, patch: UserPatch = {}): BotReply {
  return { messages: [textMsg(welcomeText(dormName), LANG_BUTTONS)], patch };
}
function mainMenu(lang: Lang, linked: boolean, intro?: string, patch: UserPatch = {}): BotReply {
  return { messages: [textMsg(intro ?? TEXT[lang].menuIntro, mainMenuItems(lang, linked))], patch: { ...idle, ...patch } };
}

/** What to answer, or null when the event is not for the bot (e.g. a payment button). */
export async function botReply(ev: BotEvent, user: BotUser, ports: BotPorts): Promise<BotReply | null> {
  const lang = user.lang;
  const linked = ports.linkedRoom !== null;
  const silent: BotReply = { messages: [], patch: {} };

  if (ev.kind === 'follow') return chooseLanguage(ports.dormName, { ...idle, handover_until: null });

  if (ev.kind === 'postback') {
    const p = parseBotPostback(ev.data);
    if (!p) return null;                                   // e.g. "pay=..." -> the webhook handles it
    if (p.action === 'lang' && (p.v === 'th' || p.v === 'en')) {
      return mainMenu(p.v, linked, `${TEXT[p.v].langSet}\n${TEXT[p.v].menuIntro}`, { lang: p.v });
    }
    if (p.action === 'langpick' || !lang) return chooseLanguage(ports.dormName, idle);
    return answerAction(p.action, p.k, lang, user, ports);
  }

  const text = ev.kind === 'text' ? ev.text : '';

  if (ev.kind === 'text' && isMenuKeyword(text)) {
    // Typing "menu" always works, also during handover, and gives the user the bot back.
    return lang ? mainMenu(lang, linked, undefined, { handover_until: null }) : chooseLanguage(ports.dormName, { ...idle, handover_until: null });
  }

  if (ev.kind === 'text' && lang && user.menu_state) return answerInput(text, lang, user, ports);

  if (inHandover(user, ports.now)) return silent;          // staff are chatting: say nothing

  const room = ev.kind === 'text' ? parseRoomNumber(text) : null;
  if (room) return linkRoom(room, lang, ports);            // the original "type your room number" flow

  if (!lang) return chooseLanguage(ports.dormName, idle);
  return mainMenu(lang, linked, TEXT[lang].notUnderstood);
}

async function answerAction(action: BotAction, k: string | undefined, lang: Lang, user: BotUser, ports: BotPorts): Promise<BotReply> {
  const T = TEXT[lang];
  const linked = ports.linkedRoom !== null;
  switch (action) {
    case 'menu':
    case 'cancel':
      return mainMenu(lang, linked, undefined, { handover_until: null });

    case 'info': {
      const key = INFO_ANSWERS.find((x) => x === k);
      if (!key) return { messages: [textMsg(T.infoIntro, infoMenuItems(lang))], patch: idle };
      if (key === 'available') {
        const v = await ports.vacancy();
        const msg = v.count > 0 ? T.vacancy(v.count, v.minRent, v.maxRent) : T.noVacancy;
        return { messages: [textMsg(msg, [q(T.btn.book, 'book'), ...endItems(lang)])], patch: idle };
      }
      const info = await ports.info(key);
      const body = (lang === 'th' ? info.th : info.en).trim();
      if (key === 'location') {
        const pin = await ports.location();
        const msgs: BotMessage[] = [];
        if (pin) {
          const address = (body.split('\n').find((l) => l.trim()) ?? ports.dormName).slice(0, 100);
          msgs.push({ type: 'location', title: (ports.dormName || T.btn.location).slice(0, 100), address: address || T.btn.location, latitude: pin.lat, longitude: pin.lng });
        }
        if (!pin && !body) return { messages: [textMsg(T.infoMissing, endItems(lang))], patch: idle };
        msgs.push(textMsg(body || T.btn.location, endItems(lang)));
        return { messages: msgs, patch: idle };
      }
      return { messages: [textMsg(body || T.infoMissing, endItems(lang))], patch: idle };
    }

    case 'connect':
      if (linked) return mainMenu(lang, true, T.alreadyLinked(ports.linkedRoom!));
      return { messages: [textMsg(T.askRoom, cancelItems(lang))], patch: { menu_state: 'ask_room', draft: {} } };

    case 'contact': {
      const c = await ports.contact();
      // One notice per request: tapping again while staff already have the chat sends nothing new.
      if (!inHandover(user, ports.now)) await ports.notifyOwner();
      return {
        messages: [textMsg(T.contact(c.hours.trim(), c.phone.trim()), [q(T.btn.back, 'menu')])],
        patch: { ...idle, handover_until: new Date(ports.now + HANDOVER_HOURS * 3600_000).toISOString(), wants_talk_at: new Date(ports.now).toISOString() },
      };
    }

    case 'book':
      return { messages: [textMsg(T.bookName, cancelItems(lang))], patch: { menu_state: 'book_name', draft: {} } };

    case 'slot': {
      const slot = SLOTS.find((x) => x === k);
      // A time button from an old message, outside the viewing questions: just show the menu.
      if (user.menu_state !== 'book_time' || !slot) return mainMenu(lang, linked);
      return saveViewing(slot, lang, user, ports);
    }

    default:
      return mainMenu(lang, linked);
  }
}

/** The user is in the middle of a question (room number, or the booking questions). */
async function answerInput(text: string, lang: Lang, user: BotUser, ports: BotPorts): Promise<BotReply> {
  const T = TEXT[lang];
  const t = text.trim();
  switch (user.menu_state) {
    case 'ask_room': {
      const room = parseRoomNumber(t);
      if (!room) return { messages: [textMsg(T.notRoom, cancelItems(lang))], patch: {} };
      return linkRoom(room, lang, ports);
    }
    case 'book_name':
      if (t.length < 2 || t.length > 100) return { messages: [textMsg(T.bookNameBad, cancelItems(lang))], patch: {} };
      return { messages: [textMsg(T.bookPhone, cancelItems(lang))], patch: { menu_state: 'book_phone', draft: { ...user.draft, name: t } } };
    case 'book_phone': {
      const phone = parsePhone(t);
      if (!phone) return { messages: [textMsg(T.bookPhoneBad, cancelItems(lang))], patch: {} };
      return { messages: [textMsg(T.bookDate, cancelItems(lang))], patch: { menu_state: 'book_date', draft: { ...user.draft, phone } } };
    }
    case 'book_date': {
      const date = parseVisitDate(t, ports.today);
      if (!date) return { messages: [textMsg(T.bookDateBad, cancelItems(lang))], patch: {} };
      return { messages: [textMsg(T.bookTime, slotItems(lang))], patch: { menu_state: 'book_time', draft: { ...user.draft, date } } };
    }
    case 'book_time': {
      const slot = parseSlot(t);
      if (!slot) return { messages: [textMsg(T.bookTimeBad, slotItems(lang))], patch: {} };
      return saveViewing(slot, lang, user, ports);
    }
    default:
      return mainMenu(lang, ports.linkedRoom !== null);
  }
}

async function saveViewing(slot: Slot, lang: Lang, user: BotUser, ports: BotPorts): Promise<BotReply> {
  const T = TEXT[lang];
  const name = user.draft.name ?? '', phone = user.draft.phone ?? '', date = user.draft.date ?? '';
  if (!name || !phone || !date) {   // should not happen; start the questions again
    return { messages: [textMsg(T.bookName, cancelItems(lang))], patch: { menu_state: 'book_name', draft: {} } };
  }
  await ports.createViewing({ name, phone, date, slot });
  return { messages: [textMsg(T.booked(name, dmy(date, lang), T.btn[slot]), endItems(lang))], patch: idle };
}

async function linkRoom(room: string, lang: Lang | null, ports: BotPorts): Promise<BotReply> {
  const r = await ports.requestLink(room);
  if (!lang) {
    // No language chosen yet: the original bilingual replies, exactly as before.
    const msg = r === 'waiting' ? MSG.waiting : r === 'not_found' ? MSG.roomNotFound(room) : MSG.alreadyLinked(room);
    return { messages: [textMsg(msg)], patch: r === 'not_found' ? {} : idle };
  }
  const L = LINK_1[lang];
  if (r === 'not_found') return { messages: [textMsg(L.roomNotFound(room), cancelItems(lang))], patch: { menu_state: 'ask_room', draft: {} } };
  const msg = r === 'waiting' ? L.waiting : L.alreadyLinked(room);
  return { messages: [textMsg(msg, [q(TEXT[lang].btn.back, 'menu')])], patch: idle };
}
