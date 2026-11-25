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

function timingSafeEqual(a: string, b: string): boolean {
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
