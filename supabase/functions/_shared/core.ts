/* Pure helpers shared by the Edge Functions (Deno), the web app (Vite) and the Node tests.
 * No imports and no runtime-specific globals: only Web Crypto, TextEncoder and btoa, which
 * all three have. Tenant-facing text is Thai first, then English. */

/* ------------------------------------------------------------------ LINE signature */
/** LINE signs the raw request body with HMAC-SHA256 using the channel secret, base64-encoded,
 *  in the x-line-signature header. Returns false for anything that does not match. */
export async function verifyLineSignature(channelSecret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!channelSecret || !signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  return timingSafeEqual(btoa(bin), signature.trim());
}

/** Constant-time string comparison (for the LINE signature and the cron secret). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ room number typed in a chat */
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** "101", " ห้อง 101 ", "Room 101", "#101", "๑๐๑" -> "101". Anything else -> null.
 *  Only says the text LOOKS like a room number; the caller checks the room exists. */
export function parseRoomNumber(text: string | null | undefined): string | null {
  let s = String(text ?? '').trim();
  s = s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  s = s.replace(/^(ห้องที่|ห้อง|room|rm\.?|no\.?|#)\s*/i, '').trim();
  return /^[0-9]{1,4}[A-Za-z]?$/.test(s) ? s.toUpperCase() : null;
}

/* ------------------------------------------------------------------ how a tenant is shown */
const TITLES = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

/** Nickname if there is one, otherwise the first name (without Mr/นาย/นางสาว...). */
export function tenantShort(t: { full_name?: string | null; nickname?: string | null } | null | undefined): string {
  const nick = (t?.nickname ?? '').trim();
  if (nick) return nick;
  const full = (t?.full_name ?? '').trim().replace(TITLES, '').trim();
  return full.split(/\s+/)[0] ?? '';
}

/** "101 (Nok)" — the way a tenant is shown everywhere, and the name to give the LINE chat. */
export function tenantLabel(room: string, t: { full_name?: string | null; nickname?: string | null } | null | undefined): string {
  const s = tenantShort(t);
  return s ? `${room} (${s})` : room;
}

/* ------------------------------------------------------------------ LINE message texts (Thai first) */
export const MSG = {
  askRoom: 'กรุณาพิมพ์เลขห้องของคุณ เช่น 101\nPlease type your room number, e.g. 101',
  waiting: 'รอเจ้าหน้าที่ยืนยัน\nWaiting for staff to confirm',
  roomNotFound: (room: string) =>
    `ไม่พบห้อง ${room} กรุณาพิมพ์เลขห้องอีกครั้ง เช่น 101\nRoom ${room} was not found. Please type your room number again, e.g. 101`,
  alreadyLinked: (room: string) =>
    `บัญชี LINE นี้เชื่อมต่อกับห้อง ${room} อยู่แล้ว\nThis LINE account is already connected to room ${room}`,
  linked: (room: string) => `เชื่อมต่อห้อง ${room} เรียบร้อย\nRoom ${room} is now connected`,
  rejected: (room: string) =>
    `ขออภัย ไม่สามารถยืนยันห้อง ${room} ได้ กรุณาติดต่อสำนักงาน หรือพิมพ์เลขห้องอีกครั้ง\n` +
    `Sorry, we could not confirm room ${room}. Please contact the office, or type your room number again.`,
} as const;

/* ------------------------------------------------------------------ money, dates, months */
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** ฿1,234.50 */
export function baht(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  return (v < 0 ? '-฿' : '฿') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const meter1 = (n: number | string | null | undefined) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 'YYYY-MM-DD' -> DD/MM/YYYY, Thai with the Buddhist year. */
export function dmy(iso: string, lang: 'th' | 'en'): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${lang === 'th' ? Number(y) + 543 : Number(y)}`;
}
export function monthName(month: string, lang: 'th' | 'en'): string {
  const [y, m] = month.split('-').map(Number);
  return lang === 'th' ? `${TH_MONTHS[m - 1]} ${y + 543}` : `${EN_MONTHS[m - 1]} ${y}`;
}

/** Today in Thailand (UTC+7) as 'YYYY-MM-DD'. */
export function bangkokToday(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
/** The month before the month of `day`, as 'YYYY-MM-01'. */
export function previousMonth(day: string): string {
  const [y, m] = day.split('-').map(Number);
  const idx = y * 12 + (m - 1) - 1;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}
/** Whole days from a to b ('YYYY-MM-DD'); negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 86400000);
}

/* ------------------------------------------------------------------ how to pay (LINE quick replies) */
export type PayMethod = 'promptpay' | 'transfer' | 'cash';
export const PAY_METHODS: readonly PayMethod[] = ['promptpay', 'transfer', 'cash'];

/** Button text (LINE allows at most 20 characters) and the text that appears in the chat when tapped. */
export const PAY_BUTTON: Record<PayMethod, { label: string; said: string }> = {
  promptpay: { label: 'สแกน QR พร้อมเพย์', said: 'สแกน QR พร้อมเพย์' },
  transfer: { label: 'โอนเข้าบัญชี', said: 'โอนเข้าบัญชี' },
  cash: { label: 'จ่ายเป็นเงินสด', said: 'จ่ายเป็นเงินสด' },
};

/** The tenant's last choice first, then the usual order. */
export function payOrder(last: string | null | undefined): PayMethod[] {
  const first = PAY_METHODS.find((m) => m === last);
  return first ? [first, ...PAY_METHODS.filter((m) => m !== first)] : [...PAY_METHODS];
}

export const payPostback = (method: PayMethod, billId: string) => `pay=${method}&bill=${billId}`;

/** "pay=cash&bill=<uuid>" -> { method, billId }; null for anything else. */
export function parsePayPostback(data: string | null | undefined): { method: PayMethod; billId: string } | null {
  const p = new URLSearchParams(String(data ?? ''));
  const method = PAY_METHODS.find((m) => m === p.get('pay'));
  const billId = p.get('bill') ?? '';
  return method && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(billId) ? { method, billId } : null;
}

/* ------------------------------------------------------------------ bill messages (Thai first) */
export interface BillForMessage {
  room: string;
  tenant: { full_name?: string | null; nickname?: string | null } | null;
  month: string;                     // 'YYYY-MM-01'
  due_date: string;                  // 'YYYY-MM-DD'
  rent: number | string;
  water_people: number | string; water_per_person: number | string; water_amount: number | string;
  elec_prev: number | string; elec_curr: number | string; elec_units: number | string;
  elec_rate: number | string; elec_amount: number | string;
  extras: { label: string; amount: number | string }[];
  total: number | string; paid: number | string; balance: number | string;
}

/** "ห้อง 101 คุณนก" */
export function billGreeting(room: string, tenant: BillForMessage['tenant']): string {
  const name = tenantShort(tenant);
  return name ? `ห้อง ${room} คุณ${name}` : `ห้อง ${room}`;
}

/** The monthly bill as sent on LINE (and copied by staff for tenants not on LINE). */
export function billMessage(b: BillForMessage): string {
  const paid = Number(b.paid) > 0;
  return [
    billGreeting(b.room, b.tenant),
    `บิลค่าเช่าเดือน ${monthName(b.month, 'th')}`,
    `ค่าเช่า ${baht(b.rent)}`,
    `ค่าน้ำ ${Number(b.water_people)} คน × ${baht(b.water_per_person)} = ${baht(b.water_amount)}`,
    `ค่าไฟ ${meter1(b.elec_units)} หน่วย (${meter1(b.elec_prev)} → ${meter1(b.elec_curr)}) × ${baht(b.elec_rate)} = ${baht(b.elec_amount)}`,
    ...b.extras.map((x) => `${x.label} ${baht(x.amount)}`),
    `รวม ${baht(b.total)}`,
    ...(paid ? [`ชำระแล้ว ${baht(b.paid)} · คงเหลือ ${baht(b.balance)}`] : []),
    `ครบกำหนดชำระ ${dmy(b.due_date, 'th')}`,
    'กรุณาเลือกวิธีชำระเงินด้านล่าง',
    '',
    `Room ${b.room} · Bill for ${monthName(b.month, 'en')}`,
    `${paid ? 'Balance' : 'Total'} ${baht(paid ? b.balance : b.total)} · Due ${dmy(b.due_date, 'en')}`,
    'Please choose how to pay below.',
  ].join('\n');
}

/** Reminder for an unpaid bill. */
export function reminderMessage(b: Pick<BillForMessage, 'room' | 'tenant' | 'month' | 'due_date' | 'balance'>, today: string): string {
  const late = daysBetween(b.due_date, today) > 0;
  return [
    billGreeting(b.room, b.tenant),
    `แจ้งเตือนค่าเช่าเดือน ${monthName(b.month, 'th')}`,
    `ยอดคงเหลือ ${baht(b.balance)} ครบกำหนด ${dmy(b.due_date, 'th')}${late ? ' (เลยกำหนดแล้ว)' : ''}`,
    'หากชำระแล้ว กรุณาส่งรูปสลิปในแชทนี้ ขอบคุณค่ะ',
    '',
    `Reminder: room ${b.room}, ${monthName(b.month, 'en')}`,
    `Balance ${baht(b.balance)}, due ${dmy(b.due_date, 'en')}${late ? ' (overdue)' : ''}`,
    'If you have paid, please send your slip here. Thank you.',
  ].join('\n');
}

export interface PayDetails {
  promptpay_id: string; bank_name: string; bank_branch: string; bank_account_name: string;
  bank_account_number: string; office_location: string; office_hours: string;
}

/** What each payment button answers. transfer gives null when the bank details are not filled in. */
export const PAY_REPLY = {
  promptpay: (room: string, balance: number | string) =>
    `ห้อง ${room} ยอดชำระ ${baht(balance)}\nสแกน QR นี้ในแอปธนาคาร ยอดเงินจะขึ้นให้อัตโนมัติ\nหลังโอนแล้ว กรุณาส่งรูปสลิปในแชทนี้\n\n` +
    `Room ${room}, amount ${baht(balance)}\nScan this QR in your banking app; the amount is filled in for you.\nAfter paying, please send your slip here.`,
  transfer: (room: string, balance: number | string, s: PayDetails) => {
    if (!s.bank_name || !s.bank_account_number || !s.bank_account_name) return null;
    return [
      `ห้อง ${room} ยอดชำระ ${baht(balance)}`,
      `ธนาคาร: ${s.bank_name}${s.bank_branch ? ` สาขา${s.bank_branch}` : ''}`,
      `ชื่อบัญชี: ${s.bank_account_name}`,
      `เลขที่บัญชี: ${s.bank_account_number}`,
      'กรุณาส่งรูปสลิปในแชทนี้ / Please send your slip here',
      '',
      `Bank transfer, room ${room}: ${baht(balance)}`,
      `Bank: ${s.bank_name}${s.bank_branch ? `, ${s.bank_branch} branch` : ''}`,
      `Account name: ${s.bank_account_name}`,
      `Account number: ${s.bank_account_number}`,
    ].join('\n');
  },
  // The office is at the dorm, so the location is optional (shown only if filled in).
  cash: (room: string, balance: number | string, s: PayDetails): string => [
    `ห้อง ${room} ยอดชำระ ${baht(balance)}`,
    'ชำระเงินสดได้ที่สำนักงานหอพัก',
    ...(s.office_location ? [`สถานที่: ${s.office_location}`] : []),
    ...(s.office_hours ? [`เวลาทำการ: ${s.office_hours}`] : []),
    '',
    `Room ${room}: ${baht(balance)}, pay cash at the dorm office`,
    ...(s.office_location ? [`Location: ${s.office_location}`] : []),
    ...(s.office_hours ? [`Hours: ${s.office_hours}`] : []),
  ].join('\n'),
  notReady:
    'ขออภัย ยังไม่มีข้อมูลสำหรับวิธีชำระนี้ กรุณาเลือกวิธีอื่นหรือติดต่อสำนักงาน\nSorry, this payment option is not set up yet. Please choose another one or contact the office.',
  paid: 'บิลนี้ชำระครบแล้ว ขอบคุณค่ะ\nThis bill is fully paid. Thank you.',
  notYours: 'ไม่พบบิลนี้สำหรับบัญชี LINE ของคุณ กรุณาติดต่อสำนักงาน\nThis bill was not found for your LINE account. Please contact the office.',
} as const;

export const SLIP_REPLY = {
  received: 'ได้รับสลิปแล้ว เจ้าหน้าที่จะตรวจสอบและยืนยันให้ ขอบคุณค่ะ\nSlip received. Staff will check and confirm it. Thank you.',
  duplicate: 'สลิปนี้เคยส่งมาแล้ว เจ้าหน้าที่จะตรวจสอบให้\nThis slip was sent before. Staff will check it.',
} as const;

/* ------------------------------------------------------------------ run summary (for the owner) */
export interface RunSummary {
  kind: 'monthly' | 'manual' | 'reminders';
  month: string | null;
  created: string[];              // rooms that got a new bill in this run
  sent: string[];                 // bill sent on LINE now
  already_sent: string[];         // sent before (idempotent: not sent again)
  not_linked: string[];           // has a bill, tenant not on LINE: send it by hand ("Copy message")
  paid: string[];                 // nothing to send, bill already paid
  no_reading: string[];           // no bill: meter not read this month
  meter_backwards: string[];      // no bill: reading lower than last month
  no_previous_reading: string[];  // no bill: no earlier reading to compare with
  reminded: string[];
  failed: { room: string; error: string }[];
}

export const emptySummary = (kind: RunSummary['kind'], month: string | null): RunSummary => ({
  kind, month, created: [], sent: [], already_sent: [], not_linked: [], paid: [],
  no_reading: [], meter_backwards: [], no_previous_reading: [], reminded: [], failed: [],
});

/** The summary pushed to the owner's LINE after the monthly run (Thai first). */
export function summaryMessage(s: RunSummary): string {
  const list = (rooms: string[]) => rooms.join(', ');
  const th: string[] = [], en: string[] = [];
  if (s.kind === 'reminders') {
    th.push(`สรุปการแจ้งเตือนค่าเช่า: ส่ง ${s.reminded.length} ห้อง`);
    en.push(`Reminders: ${s.reminded.length} sent`);
  } else {
    th.push(`สรุปบิลเดือน ${s.month ? monthName(s.month, 'th') : ''}`, `สร้างบิลใหม่ ${s.created.length} ห้อง · ส่งทาง LINE ${s.sent.length} ห้อง`);
    en.push(`Bills for ${s.month ? monthName(s.month, 'en') : ''}: ${s.created.length} created, ${s.sent.length} sent on LINE`);
    if (s.already_sent.length) th.push(`ส่งไปแล้วก่อนหน้า (ไม่ส่งซ้ำ): ${s.already_sent.length} ห้อง`);
    if (s.not_linked.length) { th.push(`ยังไม่ได้เชื่อม LINE (ต้องส่งเอง): ${list(s.not_linked)}`); en.push(`Not on LINE (send by hand): ${list(s.not_linked)}`); }
    if (s.no_reading.length) { th.push(`ไม่มีบิล – ยังไม่จดมิเตอร์: ${list(s.no_reading)}`); en.push(`No bill, meter not read: ${list(s.no_reading)}`); }
    if (s.meter_backwards.length) { th.push(`ไม่มีบิล – เลขมิเตอร์น้อยกว่าเดือนก่อน: ${list(s.meter_backwards)}`); en.push(`No bill, meter lower than last month: ${list(s.meter_backwards)}`); }
    if (s.no_previous_reading.length) { th.push(`ไม่มีบิล – ไม่มีเลขมิเตอร์เดือนก่อน: ${list(s.no_previous_reading)}`); en.push(`No bill, no earlier reading: ${list(s.no_previous_reading)}`); }
  }
  if (s.failed.length) {
    th.push(`ส่งไม่สำเร็จ: ${list(s.failed.map((f) => f.room))}`);
    en.push(`Failed: ${list(s.failed.map((f) => f.room))}`);
  }
  return [...th, '', ...en].join('\n');
}
