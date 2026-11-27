/* The LINE message sent to a guest when staff confirm their viewing or reservation in the app
 * (line-notify function). Pure, so the Node tests can check every wording. Thai uses ครับ like
 * the bot. With no language chosen in the bot, the message is Thai first, then English. */
import { baht, dmy } from './core.ts';
import type { Lang } from './lang.ts';

export type NotifyViewing = {
  guest_name: string; visit_date: string; time_of_day: string; visit_time: string | null; room_number: string | null;
};
export type NotifyReservation = {
  guest_name: string; room_number: string | null; desired_move_in: string; expires_on: string;
  booking_fee: number | string; booking_fee_paid_on: string | null;
};
export type NotifyPlace = { dormName: string; phone: string };

const TOD: Record<Lang, Record<string, string>> = {
  th: { morning: 'ช่วงเช้า', afternoon: 'ช่วงบ่าย', evening: 'ช่วงเย็น' },
  en: { morning: 'morning', afternoon: 'afternoon', evening: 'evening' },
};

/** Date plus the exact time when staff set one (24-hour), otherwise the time of day the guest chose. */
function when(v: NotifyViewing, lang: Lang): string {
  const date = dmy(v.visit_date, lang);
  if (v.visit_time) return lang === 'th' ? `${date} เวลา ${v.visit_time.slice(0, 5)} น.` : `${date} at ${v.visit_time.slice(0, 5)}`;
  const tod = TOD[lang][v.time_of_day];
  return tod ? (lang === 'th' ? `${date} ${tod}` : `${date}, ${tod}`) : date;
}

function viewingOne(v: NotifyViewing, lang: Lang, p: NotifyPlace): string {
  if (lang === 'th') {
    return [
      `คุณ${v.guest_name} นัดดูห้องได้รับการยืนยันแล้วครับ`,
      `วันที่ ${when(v, 'th')}`,
      ...(v.room_number ? [`ห้อง ${v.room_number}`] : []),
      ...(p.dormName ? [`ที่ ${p.dormName}`] : []),
      ...(p.phone ? [`โทร ${p.phone}`] : []),
      'หากต้องการเปลี่ยนวันหรือเวลา พิมพ์ "เมนู" แล้วเลือก "ติดต่อเจ้าหน้าที่" ได้เลยครับ',
    ].join('\n');
  }
  return [
    `${v.guest_name}, your room viewing is confirmed.`,
    `Date: ${when(v, 'en')}`,
    ...(v.room_number ? [`Room ${v.room_number}`] : []),
    ...(p.dormName ? [`At ${p.dormName}`] : []),
    ...(p.phone ? [`Phone ${p.phone}`] : []),
    'To change the day or time, type "menu" and choose "Contact staff".',
  ].join('\n');
}

function reservationOne(r: NotifyReservation, lang: Lang, p: NotifyPlace): string {
  const fee = Number(r.booking_fee) || 0;
  if (lang === 'th') {
    return [
      `คุณ${r.guest_name} การจองห้อง${r.room_number ? ` ${r.room_number}` : ''} ได้รับการยืนยันแล้วครับ`,
      `วันย้ายเข้า ${dmy(r.desired_move_in, 'th')}`,
      ...(fee > 0 ? [r.booking_fee_paid_on ? `ค่าจอง ${baht(fee)} ชำระแล้ว จะนำไปหักจากเงินประกัน` : `ค่าจอง ${baht(fee)} (ยังไม่ได้ชำระ)`] : []),
      `ห้องจะถูกเก็บไว้ให้ถึงวันที่ ${dmy(r.expires_on, 'th')}`,
      ...(p.phone ? [`สอบถามได้ที่ ${p.phone}`] : []),
      'ขอบคุณครับ',
    ].join('\n');
  }
  return [
    `${r.guest_name}, your reservation${r.room_number ? ` for room ${r.room_number}` : ''} is confirmed.`,
    `Move-in date: ${dmy(r.desired_move_in, 'en')}`,
    ...(fee > 0 ? [r.booking_fee_paid_on ? `Booking fee ${baht(fee)} paid; it counts toward your deposit.` : `Booking fee ${baht(fee)} (not paid yet)`] : []),
    `The room is held for you until ${dmy(r.expires_on, 'en')}.`,
    ...(p.phone ? [`Questions: ${p.phone}`] : []),
    'Thank you!',
  ].join('\n');
}

const both = (th: string, en: string) => `${th}\n\n${en}`;

export function viewingConfirmedText(v: NotifyViewing, lang: Lang | null, p: NotifyPlace): string {
  return lang ? viewingOne(v, lang, p) : both(viewingOne(v, 'th', p), viewingOne(v, 'en', p));
}
export function reservationConfirmedText(r: NotifyReservation, lang: Lang | null, p: NotifyPlace): string {
  return lang ? reservationOne(r, lang, p) : both(reservationOne(r, 'th', p), reservationOne(r, 'en', p));
}
