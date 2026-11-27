/* Invoice (ใบแจ้งหนี้): the data a printed invoice shows, its numbered lines, the amount in Thai
 * words and the footer. Pure (no imports), so scripts/test-invoice.ts runs it with plain `node`.
 * Used by the in-app invoice page and by the public page opened from the LINE link (whose data
 * comes from the "invoice" Edge Function in exactly this shape). */

export interface InvoiceBill {
  id: string;
  invoice_no: string;
  month: string;                 // bill month 'YYYY-MM-01'
  rent_month: string | null;     // null on a final (usage-only) bill
  usage_month: string | null;    // null on a first bill
  room_number: string;
  rent: number;
  common_fee: number;
  water_people: number; water_per_person: number; water_amount: number;
  elec_prev: number; elec_curr: number; elec_units: number; elec_amount: number;
  total: number;
  due_date: string;              // 'YYYY-MM-DD'
  created_at: string;            // ISO timestamp
  note: string;
  issued_by_name: string;
}

export interface InvoiceDorm {
  name: string; name_en: string; address: string; tax_id: string; phone: string; email: string;
  line_oa_id: string; invoice_note: string; biller_name: string;
  bank_name: string; bank_branch: string; bank_account_name: string; bank_account_number: string; promptpay_id: string;
  logo: string | null;           // image URL (signed URL in the app, data: URL from the Edge Function)
}

export interface InvoiceData {
  bill: InvoiceBill;
  extras: { label: string; amount: number }[];
  tenant: { full_name: string; address: string; phone: string } | null;
  dorm: InvoiceDorm;
}

export interface InvoiceLine { no: number; text: string; amount: number }

/* ------------------------------------------------------------------ number formatting */
/** 4800 -> "4,800.00" */
export const money2 = (n: number) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 300 -> "300", 105.5 -> "105.50" (prices inside a line's description). */
export const price = (n: number) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString('en-US') : money2(v);
};
/** Meter numbers: 7212 -> "7212", 7212.5 -> "7212.5" (no thousands separator, like the meter). */
export const meterNo = (n: number) => {
  const v = Math.round(Number(n || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};
/** 'YYYY-MM-01' -> "12/2026" */
export const mmYYYY = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
/** ISO date or timestamp -> "01/12/2026" (Bangkok date for timestamps). */
export function ddmmyyyy(iso: string): string {
  const day = iso.length > 10 ? new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString().slice(0, 10) : iso;
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/* ------------------------------------------------------------------ amount in Thai words */
const DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACE = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** 0 < n < 1,000,000. `more` = there is a non-zero part in front (so a final 1 reads เอ็ด). */
function below1m(n: number, more: boolean): string {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]), pos = s.length - 1 - i;
    if (d === 0) continue;
    if (pos === 0 && d === 1 && (n > 9 || more)) out += 'เอ็ด';
    else if (pos === 1 && d === 1) out += 'สิบ';
    else if (pos === 1 && d === 2) out += 'ยี่สิบ';
    else out += DIGIT[d] + PLACE[pos];
  }
  return out;
}

/** Whole number in Thai words, with ล้าน groups (also ล้านล้าน). 0 -> ''. */
function intWords(n: number, more = false): string {
  if (n === 0) return '';
  if (n < 1_000_000) return below1m(n, more);
  const high = Math.floor(n / 1_000_000), low = n % 1_000_000;
  return intWords(high, more) + 'ล้าน' + (low ? below1m(low, true) : '');
}

/** 11228 -> "หนึ่งหมื่นหนึ่งพันสองร้อยยี่สิบแปดบาทถ้วน"; 0.5 -> "ห้าสิบสตางค์"; 0 -> "ศูนย์บาทถ้วน". */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const total = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(total / 100), satang = total % 100;
  const sign = amount < 0 && total > 0 ? 'ลบ' : '';
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน';
  const b = baht ? intWords(baht) + 'บาท' : '';
  return sign + b + (satang ? intWords(satang) + 'สตางค์' : 'ถ้วน');
}

/* ------------------------------------------------------------------ lines */
/** The numbered lines: rent (rent month), common fee (the bill's own value), water and electric
 *  (usage month, with people x price and the meter numbers), then extra charges. */
export function invoiceLines(d: Pick<InvoiceData, 'bill' | 'extras'>): InvoiceLine[] {
  const b = d.bill;
  const lines: Omit<InvoiceLine, 'no'>[] = [];
  if (b.rent_month) {
    lines.push({ text: `ค่าเช่าห้อง (Room rate) ${b.room_number} เดือน ${mmYYYY(b.rent_month)}`, amount: Number(b.rent) });
  }
  if (Number(b.common_fee) > 0) {
    const fee = price(b.common_fee);
    lines.push({ text: `ส่วนกลาง (${fee} บาท) (Common Fee (${fee} THB))`, amount: Number(b.common_fee) });
  }
  if (b.usage_month) {
    lines.push({
      text: `ค่าน้ำ (Water rate) เดือน ${mmYYYY(b.usage_month)} (${Number(b.water_people)} คน × ${price(b.water_per_person)})`,
      amount: Number(b.water_amount),
    });
    lines.push({
      text: `ค่าไฟฟ้า (Electrical rate) เดือน ${mmYYYY(b.usage_month)} (${meterNo(b.elec_curr)} - ${meterNo(b.elec_prev)} = ${meterNo(b.elec_units)} ยูนิต)`,
      amount: Number(b.elec_amount),
    });
  }
  for (const x of d.extras) lines.push({ text: x.label, amount: Number(x.amount) });
  return lines.map((l, i) => ({ no: i + 1, ...l }));
}

/* ------------------------------------------------------------------ footer */
/** Footer lines, Thai then English; parts whose setting is empty are left out. */
export function invoiceFooter(d: Pick<InvoiceData, 'bill' | 'dorm'>): string[] {
  const s = d.dorm;
  const dueDay = Number(d.bill.due_date.slice(8, 10));
  const out = [`กรุณาชำระภายในวันที่ 1–${dueDay} ของทุกเดือน`, `Please pay between the 1st and the ${ordinal(dueDay)} of each month.`];
  if (s.bank_name && s.bank_account_number) {
    out.push([`ธนาคาร${s.bank_name}`, s.bank_branch && `สาขา${s.bank_branch}`, s.bank_account_name && `ชื่อบัญชี ${s.bank_account_name}`,
      `เลขที่บัญชี ${s.bank_account_number}`].filter(Boolean).join(' '));
    out.push([`Bank: ${s.bank_name}`, s.bank_branch && `${s.bank_branch} branch`, s.bank_account_name && `account name ${s.bank_account_name}`,
      `account no. ${s.bank_account_number}`].filter(Boolean).join(', '));
  }
  if (s.promptpay_id) out.push(`พร้อมเพย์ (PromptPay): ${s.promptpay_id}`);
  const contact = [s.line_oa_id && `LINE ${s.line_oa_id}`, s.phone].filter(Boolean) as string[];
  if (contact.length) {
    out.push(`มีปัญหาการโอน แจ้งทาง ${contact.join(' หรือ ')}`);
    out.push(`Problems with your transfer? Tell us on ${contact.join(' or ')}.`);
  }
  return out;
}

function ordinal(n: number): string {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}
