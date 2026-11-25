/* Formatting helpers. Dates are handled as plain 'YYYY-MM-DD' strings (the way Postgres
 * returns `date` columns) so no time-zone shifting can move a date by a day. */

export type Lang = 'th' | 'en';

/** "101 (Nok)": nickname, else first name. Shared with the LINE Edge Functions. */
export { tenantLabel, tenantShort } from '../../supabase/functions/_shared/core';

const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
};

/** ฿1,234.50 — always 2 decimals. */
export function money(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-฿' : '฿') + s;
}

/** Meter numbers / units: 1 decimal. */
export function meter(n: number | string | null | undefined): string {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** DD/MM/YYYY. Thai shows the Buddhist year (2026 -> 2569). */
export function dateLabel(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return '—';
  const year = lang === 'th' ? Number(y) + 543 : Number(y);
  return `${d}/${m}/${year}`;
}

/** "November 2026" / "พฤศจิกายน 2569". Accepts 'YYYY-MM' or 'YYYY-MM-DD'. */
export function monthLabel(month: string | null | undefined, lang: Lang): string {
  if (!month) return '—';
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[lang][m - 1]} ${lang === 'th' ? y + 543 : y}`;
}

/** Today's date in Thailand (UTC+7), as 'YYYY-MM-DD'. */
export function todayISO(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** First day of the current Bangkok month, 'YYYY-MM-01'. */
export function currentMonth(): string {
  return todayISO().slice(0, 7) + '-01';
}

/** 'YYYY-MM-01' shifted by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/** Last day of the month of a 'YYYY-MM-..' string. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** <input type="month"> uses 'YYYY-MM'; the database uses 'YYYY-MM-01'. */
export const toMonthInput = (month: string) => month.slice(0, 7);
export const fromMonthInput = (v: string) => (v ? v + '-01' : currentMonth());

/** Natural sort for room numbers ("2" < "10"). */
export function byRoomNumber(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Parse a number typed by a person ("1,234.5" -> 1234.5). Returns null when empty/invalid. */
export function parseNum(v: FormDataEntryValue | string | null | undefined): number | null {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
