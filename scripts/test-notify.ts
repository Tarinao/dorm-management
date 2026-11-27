/* Tests for the LINE message sent when staff confirm a viewing or reservation
 * (supabase/functions/_shared/notify.ts), and that the bot's Thai replies use ครับ.
 * Run: npm run test:notify */
import { reservationConfirmedText, viewingConfirmedText, type NotifyReservation, type NotifyViewing } from '../supabase/functions/_shared/notify.ts';
import { TEXT, welcomeText } from '../supabase/functions/_shared/bot.ts';
import { LINK_1, PAY_REPLY_1, SLIP_REPLY_1 } from '../supabase/functions/_shared/lang.ts';
import { PAY_REPLY, SLIP_REPLY, reminderMessage } from '../supabase/functions/_shared/core.ts';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`); }
}
function ok(cond: unknown, what: string) { if (!cond) throw new Error(what); }
const THAI = /[ก-ฺเ-๛]/, LATIN = /[A-Za-z]{3,}/;

const place = { dormName: 'Baan Suk', phone: '021234567' };
const viewing: NotifyViewing = { guest_name: 'พล', visit_date: '2026-12-15', time_of_day: 'afternoon', visit_time: null, room_number: null };
const reservation: NotifyReservation = {
  guest_name: 'พล', room_number: '101', desired_move_in: '2027-01-01', expires_on: '2027-01-08', booking_fee: 1000, booking_fee_paid_on: '2026-12-20',
};

test('viewing, Thai: name, Buddhist date, time of day, place, phone, ครับ, no English', () => {
  const m = viewingConfirmedText(viewing, 'th', place);
  for (const s of ['คุณพล', '15/12/2569', 'ช่วงบ่าย', 'Baan Suk', '021234567', 'ครับ']) ok(m.includes(s), `missing "${s}" in:\n${m}`);
  ok(!/ค่ะ|คะ/.test(m), 'no ค่ะ/คะ');
  ok(!/confirmed|viewing/i.test(m), 'no English sentences');
});

test('viewing, English: no Thai text', () => {
  const m = viewingConfirmedText(viewing, 'en', place);
  ok(m.includes('15/12/2026') && m.includes('afternoon') && m.includes('confirmed'), m);
  ok(!/[ก-ฮ]/.test(m.replace('พล', '')), 'only the guest name may be Thai');
});

test('viewing: exact time and room when staff set them; nothing for "any" time', () => {
  const m = viewingConfirmedText({ ...viewing, visit_time: '14:30:00', room_number: '203' }, 'th', place);
  ok(m.includes('เวลา 14:30 น.') && m.includes('ห้อง 203') && !m.includes('ช่วงบ่าย'), m);
  const any = viewingConfirmedText({ ...viewing, time_of_day: 'any' }, 'en', place);
  ok(any.includes('Date: 15/12/2026\n'), any);
});

test('no language chosen in the bot: Thai first, then English', () => {
  const m = viewingConfirmedText(viewing, null, place);
  const [th, en] = m.split('\n\n');
  ok(THAI.test(th) && LATIN.test(en) && en.includes('confirmed'), m);
});

test('reservation: room, move-in date, paid fee counts toward deposit, held until', () => {
  const th = reservationConfirmedText(reservation, 'th', place);
  for (const s of ['ห้อง 101', '01/01/2570', '฿1,000.00', 'ชำระแล้ว', '08/01/2570', 'ครับ']) ok(th.includes(s), `missing "${s}" in:\n${th}`);
  const en = reservationConfirmedText(reservation, 'en', place);
  for (const s of ['room 101', '01/01/2027', 'counts toward your deposit', '08/01/2027']) ok(en.includes(s), `missing "${s}" in:\n${en}`);
});

test('reservation: unpaid fee says so; no fee line when there is no fee; empty phone left out', () => {
  ok(reservationConfirmedText({ ...reservation, booking_fee_paid_on: null }, 'en', place).includes('(not paid yet)'), 'unpaid');
  const free = reservationConfirmedText({ ...reservation, booking_fee: 0 }, 'th', { dormName: '', phone: '' });
  ok(!free.includes('ค่าจอง') && !free.includes('สอบถาม'), free);
});

test('every Thai bot / LINE reply uses ครับ, never ค่ะ or คะ', () => {
  const all: string[] = [welcomeText('X'), reminderMessage({ room: '101', tenant: null, month: '2026-12-01', due_date: '2026-12-05', balance: 100 }, '2026-12-01')];
  const walk = (x: unknown) => {
    if (typeof x === 'string') all.push(x);
    else if (typeof x === 'function') { try { all.push(String((x as (...a: unknown[]) => unknown)('101', 100, { bank_name: 'B', bank_account_number: '1', bank_account_name: 'N', office_location: 'L', office_hours: 'H' }))); } catch { /* */ } }
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(TEXT.th); walk(LINK_1.th); walk(PAY_REPLY_1.th); walk(SLIP_REPLY_1.th); walk(PAY_REPLY); walk(SLIP_REPLY);
  const bad = all.filter((s) => /ค่ะ|คะ(?![ก-๎])/.test(s));
  ok(bad.length === 0, `still ค่ะ/คะ: ${bad.join(' | ')}`);
  ok(all.some((s) => s.includes('ครับ')), 'ครับ is used');
  // The shared files themselves (catches texts the walk above cannot call).
  for (const f of ['bot', 'lang', 'core', 'notify']) {
    const src = readFileSync(new URL(`../supabase/functions/_shared/${f}.ts`, import.meta.url), 'utf8');
    ok(!/ค่ะ|คะ(?![ก-๎])/.test(src), `${f}.ts still has ค่ะ/คะ`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
