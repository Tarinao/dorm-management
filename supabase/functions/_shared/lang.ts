/* Single-language versions of the tenant replies, for LINE users who chose Thai or English in the
 * bot. Users who never chose a language keep getting the original bilingual texts from core.ts
 * (MSG, PAY_REPLY, SLIP_REPLY): nothing changes for them. Same content, same logic: only the
 * language differs. Pure (no runtime imports except core.ts), so the Node tests can load it. */
import { baht, type PayDetails, type PayMethod } from './core.ts';

export type Lang = 'th' | 'en';
export const isLang = (v: unknown): v is Lang => v === 'th' || v === 'en';

/** Room-linking replies (same meaning as MSG in core.ts). */
export const LINK_1: Record<Lang, {
  askRoom: string; waiting: string; roomNotFound: (r: string) => string; alreadyLinked: (r: string) => string;
  linked: (r: string) => string; rejected: (r: string) => string;
}> = {
  th: {
    askRoom: 'กรุณาพิมพ์เลขห้องของคุณ เช่น 101',
    waiting: 'ได้รับคำขอแล้ว รอเจ้าหน้าที่ยืนยันครับ',
    roomNotFound: (r) => `ไม่พบห้อง ${r} กรุณาพิมพ์เลขห้องอีกครั้ง เช่น 101`,
    alreadyLinked: (r) => `บัญชีนี้เชื่อมต่อกับห้อง ${r} อยู่แล้วครับ`,
    linked: (r) => `เชื่อมต่อห้อง ${r} เรียบร้อยแล้วครับ`,
    rejected: (r) => `ขออภัย ไม่สามารถยืนยันห้อง ${r} ได้ กรุณาติดต่อสำนักงาน หรือพิมพ์เลขห้องอีกครั้ง`,
  },
  en: {
    askRoom: 'Please type your room number, e.g. 101',
    waiting: 'Request received. Waiting for staff to confirm.',
    roomNotFound: (r) => `Room ${r} was not found. Please type your room number again, e.g. 101`,
    alreadyLinked: (r) => `This account is already connected to room ${r}.`,
    linked: (r) => `Room ${r} is now connected.`,
    rejected: (r) => `Sorry, we could not confirm room ${r}. Please contact the office, or type your room number again.`,
  },
};

/** Payment-button labels (LINE: at most 20 characters). Thai = the labels used today. */
export const PAY_BUTTON_1: Record<Lang, Record<PayMethod, string>> = {
  th: { promptpay: 'สแกน QR พร้อมเพย์', transfer: 'โอนเข้าบัญชี', cash: 'จ่ายเป็นเงินสด' },
  en: { promptpay: 'PromptPay QR', transfer: 'Bank transfer', cash: 'Pay cash' },
};

/** What each payment button answers (same content as PAY_REPLY in core.ts, one language). */
export const PAY_REPLY_1: Record<Lang, {
  promptpay: (room: string, balance: number | string) => string;
  transfer: (room: string, balance: number | string, s: PayDetails) => string | null;
  cash: (room: string, balance: number | string, s: PayDetails) => string;
  notReady: string; paid: string; notYours: string;
}> = {
  th: {
    promptpay: (room, balance) =>
      `ห้อง ${room} ยอดชำระ ${baht(balance)}\nสแกน QR นี้ในแอปธนาคาร ยอดเงินจะขึ้นให้อัตโนมัติ\nหลังโอนแล้ว กรุณาส่งรูปสลิปในแชทนี้`,
    transfer: (room, balance, s) => {
      if (!s.bank_name || !s.bank_account_number || !s.bank_account_name) return null;
      return [
        `ห้อง ${room} ยอดชำระ ${baht(balance)}`,
        `ธนาคาร: ${s.bank_name}${s.bank_branch ? ` สาขา${s.bank_branch}` : ''}`,
        `ชื่อบัญชี: ${s.bank_account_name}`,
        `เลขที่บัญชี: ${s.bank_account_number}`,
        'กรุณาส่งรูปสลิปในแชทนี้',
      ].join('\n');
    },
    cash: (room, balance, s) => [
      `ห้อง ${room} ยอดชำระ ${baht(balance)}`,
      'ชำระเงินสดได้ที่สำนักงานหอพัก',
      ...(s.office_location ? [`สถานที่: ${s.office_location}`] : []),
      ...(s.office_hours ? [`เวลาทำการ: ${s.office_hours}`] : []),
    ].join('\n'),
    notReady: 'ขออภัย ยังไม่มีข้อมูลสำหรับวิธีชำระนี้ กรุณาเลือกวิธีอื่นหรือติดต่อสำนักงาน',
    paid: 'บิลนี้ชำระครบแล้ว ขอบคุณครับ',
    notYours: 'ไม่พบบิลนี้สำหรับบัญชีของคุณ กรุณาติดต่อสำนักงาน',
  },
  en: {
    promptpay: (room, balance) =>
      `Room ${room}, amount ${baht(balance)}\nScan this QR in your banking app; the amount is filled in for you.\nAfter paying, please send your slip here.`,
    transfer: (room, balance, s) => {
      if (!s.bank_name || !s.bank_account_number || !s.bank_account_name) return null;
      return [
        `Bank transfer, room ${room}: ${baht(balance)}`,
        `Bank: ${s.bank_name}${s.bank_branch ? `, ${s.bank_branch} branch` : ''}`,
        `Account name: ${s.bank_account_name}`,
        `Account number: ${s.bank_account_number}`,
        'Please send your slip here.',
      ].join('\n');
    },
    cash: (room, balance, s) => [
      `Room ${room}: ${baht(balance)}, pay cash at the dorm office`,
      ...(s.office_location ? [`Location: ${s.office_location}`] : []),
      ...(s.office_hours ? [`Hours: ${s.office_hours}`] : []),
    ].join('\n'),
    notReady: 'Sorry, this payment option is not set up yet. Please choose another one or contact the office.',
    paid: 'This bill is fully paid. Thank you.',
    notYours: 'This bill was not found for your account. Please contact the office.',
  },
};

export const SLIP_REPLY_1: Record<Lang, { received: string; duplicate: string }> = {
  th: {
    received: 'ได้รับสลิปแล้ว เจ้าหน้าที่จะตรวจสอบและยืนยันให้ ขอบคุณครับ',
    duplicate: 'สลิปนี้เคยส่งมาแล้ว เจ้าหน้าที่จะตรวจสอบให้',
  },
  en: {
    received: 'Slip received. Staff will check and confirm it. Thank you.',
    duplicate: 'This slip was sent before. Staff will check it.',
  },
};
