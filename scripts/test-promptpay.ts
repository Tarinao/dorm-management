/* Tests for the PromptPay QR payload, CRC16, slip QR references and the LINE bill messages.
 * Run: npm run test:promptpay */
import { crc16, hasValidCrc, parseTlv, promptPayKind, promptPayPayload, slipKey, slipReference } from '../supabase/functions/_shared/promptpay.ts';
import {
  PAY_BUTTON, PAY_METHODS, PAY_REPLY, SLIP_REPLY, billMessage, parsePayPostback, payOrder, payPostback,
  previousMonth, reminderMessage, bangkokToday, daysBetween, emptySummary, summaryMessage,
} from '../supabase/functions/_shared/core.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`); }
}
function eq<T>(actual: T, expected: T, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
/** Bit-by-bit CRC-16/CCITT-FALSE written differently from the one under test (reflected loop order). */
function crcReference(s: string): string {
  let crc = 0xffff;
  for (const ch of Buffer.from(s, 'utf8')) {
    for (let bit = 7; bit >= 0; bit--) {
      const top = ((crc >> 15) & 1) ^ ((ch >> bit) & 1);
      crc = (crc << 1) & 0xffff;
      if (top) crc ^= 0x1021;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

console.log('CRC16 (CCITT-FALSE)');
test('standard check value: "123456789" -> 29B1', () => eq(crc16('123456789'), '29B1'));
test('matches an independent implementation', () => {
  for (const s of ['', 'A', '6304', '00020101021129370016A000000677010111', 'ห้อง 101']) eq(crc16(s), crcReference(s), s);
});
test('always 4 uppercase hex digits', () => eq(/^[0-9A-F]{4}$/.test(crc16('x')), true));

console.log('PromptPay payload');
// Reference payloads produced by the widely used open-source "promptpay-qr" library.
test('reference: phone 000-000-0000, amount 4.22', () =>
  eq(promptPayPayload('000-000-0000', 4.22), '00020101021229370016A000000677010111011300660000000005802TH530376454044.226304E469'));
test('reference: national ID 1111111111111, no amount', () =>
  eq(promptPayPayload('1111111111111'), '00020101021129370016A000000677010111021311111111111115802TH530376463047B5A'));
test('phone type: 0812345678 becomes 0066812345678 in field 29/01', () => {
  const p = promptPayPayload('0812345678', 1500);
  const merchant = parseTlv(parseTlv(p)!.get('29')!)!;
  eq(merchant.get('00'), 'A000000677010111');
  eq(merchant.get('01'), '0066812345678');
});
test('exact amount with 2 decimals; dynamic QR (01=12)', () => {
  const f = parseTlv(promptPayPayload('0812345678', 4260.5))!;
  eq(f.get('54'), '4260.50'); eq(f.get('01'), '12'); eq(f.get('53'), '764'); eq(f.get('58'), 'TH');
});
test('amount is rounded to satang (no float noise)', () => {
  eq(parseTlv(promptPayPayload('0812345678', 0.1 + 0.2))!.get('54'), '0.30');
  eq(parseTlv(promptPayPayload('0812345678', 1234.005))!.get('54'), '1234.01');
});
test('no amount -> static QR (01=11), no field 54', () => {
  const f = parseTlv(promptPayPayload('0812345678'))!;
  eq(f.get('01'), '11'); eq(f.has('54'), false);
});
test('every payload ends with a correct CRC', () => {
  for (const p of [promptPayPayload('0812345678', 99.99), promptPayPayload('1234567890123', 1), promptPayPayload('0999999999')]) {
    eq(hasValidCrc(p), true, p);
  }
  eq(hasValidCrc(promptPayPayload('0812345678', 100).replace('100.00', '900.00')), false, 'changed amount');
});
test('bad PromptPay numbers are refused', () => {
  eq(promptPayKind('0812345678'), 'phone'); eq(promptPayKind('081-234-5678'), 'phone');
  eq(promptPayKind('1234567890123'), 'national_id');
  for (const bad of ['', '812345678', '08123456789', 'abc', '123456789012']) {
    eq(promptPayKind(bad), null, bad);
    let threw = false; try { promptPayPayload(bad, 1); } catch { threw = true; }
    eq(threw, true, `payload for ${bad}`);
  }
});

console.log('Slip QR reference (duplicate check)');
const inner = '0006000001' + '0103004' + '0224' + '014316112311APM03917XYZA';
const SLIP = '00' + String(inner.length).padStart(2, '0') + inner + '5102TH' + '9104';
const SLIP_QR = SLIP + crc16(SLIP);
test('reads bank and reference from a Thai slip QR', () => eq(slipReference(SLIP_QR), '004:014316112311APM03917XYZA'));
test('the same slip twice gives the same key', () => eq(slipKey(SLIP_QR), slipKey(` ${SLIP_QR} `)));
test('different slips give different keys', () => {
  const other = SLIP_QR.replace('XYZA', 'XYZB');
  eq(slipKey(other) !== slipKey(SLIP_QR), true);
});
test('a PromptPay QR (not a slip) is not a slip reference, but still has a key', () => {
  const pp = promptPayPayload('0812345678', 10);
  eq(slipReference(pp), null);
  eq(slipKey(pp), `raw:${pp}`);
});
test('no QR -> no key', () => { eq(slipKey(''), null); eq(slipKey(null), null); eq(slipReference('hello'), null); });

console.log('Payment buttons');
test('LINE button labels are at most 20 characters', () => {
  for (const m of PAY_METHODS) eq(PAY_BUTTON[m].label.length <= 20, true, `${m}: ${PAY_BUTTON[m].label} (${PAY_BUTTON[m].label.length})`);
});
test('the three buttons, in the brief\'s wording', () => {
  eq(PAY_BUTTON.promptpay.said, 'สแกน QR พร้อมเพย์');
  eq(PAY_BUTTON.transfer.said, 'โอนเข้าบัญชี');
  eq(PAY_BUTTON.cash.said, 'จ่ายเป็นเงินสด');
});
test('last month\'s choice comes first', () => {
  eq(payOrder(null), ['promptpay', 'transfer', 'cash']);
  eq(payOrder('cash'), ['cash', 'promptpay', 'transfer']);
  eq(payOrder('transfer'), ['transfer', 'promptpay', 'cash']);
  eq(payOrder('nonsense'), ['promptpay', 'transfer', 'cash']);
});
test('postback data round trip; junk is refused', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  eq(parsePayPostback(payPostback('cash', id)), { method: 'cash', billId: id });
  eq(parsePayPostback('pay=card&bill=' + id), null);
  eq(parsePayPostback('pay=cash&bill=1 or 1=1'), null);
  eq(parsePayPostback(undefined), null);
});

console.log('Replies');
const S = {
  promptpay_id: '0812345678', bank_name: 'กสิกรไทย', bank_branch: 'สีลม', bank_account_name: 'หอพักทดสอบ',
  bank_account_number: '123-4-56789-0', office_location: 'ชั้น 1 ข้างลิฟต์', office_hours: '09:00-18:00',
};
test('bank transfer: bank details + "please send your slip here"', () => {
  const r = PAY_REPLY.transfer('101', 4260.5, S)!;
  for (const part of ['กสิกรไทย', 'หอพักทดสอบ', '123-4-56789-0', '฿4,260.50', 'กรุณาส่งรูปสลิปในแชทนี้ / Please send your slip here']) eq(r.includes(part), true, part);
});
test('cash: office location and hours', () => {
  const r = PAY_REPLY.cash('101', 100, S)!;
  eq(r.includes('ชั้น 1 ข้างลิฟต์') && r.includes('09:00-18:00'), true);
});
test('bank details missing -> "not set up"; cash works without a location', () => {
  eq(PAY_REPLY.transfer('101', 1, { ...S, bank_account_number: '' }), null);
  const c = PAY_REPLY.cash('101', 1, { ...S, office_location: '', office_hours: '' });
  eq(c.includes('ชำระเงินสดได้ที่สำนักงานหอพัก') && !c.includes('สถานที่') && !c.includes('null'), true, 'cash without location');
});
test('every tenant message starts with Thai', () => {
  const all = [PAY_REPLY.promptpay('101', 1), PAY_REPLY.transfer('101', 1, S)!, PAY_REPLY.cash('101', 1, S)!, PAY_REPLY.notReady,
    PAY_REPLY.paid, PAY_REPLY.notYours, SLIP_REPLY.received, SLIP_REPLY.duplicate];
  for (const m of all) eq(/^[฀-๿]/.test(m), true, m.slice(0, 20));
});

console.log('Bill message');
const BILL = {
  room: '101', tenant: { full_name: 'นางสาว สุดา มีสุข', nickname: 'นก' }, month: '2026-11-01', due_date: '2026-12-05',
  rent: 3000, water_people: 2, water_per_person: 150, water_amount: 300,
  elec_prev: 1200, elec_curr: 1320, elec_units: 120, elec_rate: 8, elec_amount: 960,
  extras: [{ label: 'ค่าส่วนกลาง', amount: 100 }], total: 4360, paid: 0, balance: 4360,
};
test('starts "ห้อง {room} คุณ{nickname}" and has every line', () => {
  const m = billMessage(BILL);
  eq(m.split('\n')[0], 'ห้อง 101 คุณนก');
  for (const part of ['พฤศจิกายน 2569', 'ค่าเช่า ฿3,000.00', '2 คน × ฿150.00 = ฿300.00', '120.0 หน่วย (1,200.0 → 1,320.0)',
    'ค่าส่วนกลาง ฿100.00', 'รวม ฿4,360.00', '05/12/2569', 'Due 05/12/2026']) eq(m.includes(part), true, part);
});
test('no nickname -> first name without the title', () =>
  eq(billMessage({ ...BILL, tenant: { full_name: 'นางสาว สุดา มีสุข', nickname: '' } }).split('\n')[0], 'ห้อง 101 คุณสุดา'));
test('partly paid shows the balance', () => {
  const m = billMessage({ ...BILL, paid: 1000, balance: 3360 });
  eq(m.includes('คงเหลือ ฿3,360.00') && m.includes('Balance ฿3,360.00'), true);
});
test('reminder says overdue only after the due date', () => {
  eq(reminderMessage(BILL, '2026-12-05').includes('เลยกำหนด'), false);
  eq(reminderMessage(BILL, '2026-12-06').includes('(เลยกำหนดแล้ว)'), true);
});

console.log('Owner summary');
test('rooms without a bill are listed by reason; Thai first', () => {
  const s = { ...emptySummary('monthly', '2026-11-01'), created: ['101', '102'], sent: ['102'], not_linked: ['101'], no_reading: ['203', '305'], meter_backwards: ['410'] };
  const m = summaryMessage(s);
  eq(/^[฀-๿]/.test(m), true);
  for (const part of ['พฤศจิกายน 2569', 'ยังไม่จดมิเตอร์: 203, 305', 'น้อยกว่าเดือนก่อน: 410', 'No bill, meter not read: 203, 305', 'Not on LINE (send by hand): 101']) {
    eq(m.includes(part), true, part);
  }
});

console.log('Dates');
test('previous month, across the new year', () => { eq(previousMonth('2026-12-01'), '2026-11-01'); eq(previousMonth('2027-01-01'), '2026-12-01'); });
test('Bangkok date: 1 Jan 00:30 Bangkok is still 31 Dec in UTC', () =>
  eq(bangkokToday(Date.parse('2026-12-31T17:30:00Z')), '2027-01-01'));
test('days between', () => { eq(daysBetween('2026-12-05', '2026-12-08'), 3); eq(daysBetween('2026-12-05', '2026-12-01'), -4); });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
