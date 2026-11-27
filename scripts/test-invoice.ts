/* Invoice tests: the amount in Thai words (bahtText), the numbered lines and the footer.
 * Run: npm run test:invoice */
import assert from 'node:assert/strict';
import { bahtText, invoiceFooter, invoiceLines, type InvoiceData } from '../src/lib/invoice.ts';
import { hashToken, invoiceUrl, isToken, newToken } from '../supabase/functions/_shared/invoicelink.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${(e as Error).message}`); process.exitCode = 1; }
}

console.log('Amount in Thai words');

test('the example total: 11,228 -> หนึ่งหมื่นหนึ่งพันสองร้อยยี่สิบแปดบาทถ้วน', () => {
  assert.equal(bahtText(11228), 'หนึ่งหมื่นหนึ่งพันสองร้อยยี่สิบแปดบาทถ้วน');
});

test('zero, satang only, baht + satang', () => {
  assert.equal(bahtText(0), 'ศูนย์บาทถ้วน');
  assert.equal(bahtText(0.5), 'ห้าสิบสตางค์');
  assert.equal(bahtText(0.01), 'หนึ่งสตางค์');
  assert.equal(bahtText(0.21), 'ยี่สิบเอ็ดสตางค์');
  assert.equal(bahtText(1.01), 'หนึ่งบาทหนึ่งสตางค์');
  assert.equal(bahtText(6528.75), 'หกพันห้าร้อยยี่สิบแปดบาทเจ็ดสิบห้าสตางค์');
  assert.equal(bahtText(1128.005), 'หนึ่งพันหนึ่งร้อยยี่สิบแปดบาทหนึ่งสตางค์');   // rounded to satang
});

test('round numbers', () => {
  assert.equal(bahtText(1), 'หนึ่งบาทถ้วน');
  assert.equal(bahtText(10), 'สิบบาทถ้วน');
  assert.equal(bahtText(100), 'หนึ่งร้อยบาทถ้วน');
  assert.equal(bahtText(300), 'สามร้อยบาทถ้วน');
  assert.equal(bahtText(5000), 'ห้าพันบาทถ้วน');
  assert.equal(bahtText(10000), 'หนึ่งหมื่นบาทถ้วน');
  assert.equal(bahtText(100000), 'หนึ่งแสนบาทถ้วน');
});

test('เอ็ด and ยี่ rules', () => {
  assert.equal(bahtText(11), 'สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(21), 'ยี่สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(20), 'ยี่สิบบาทถ้วน');
  assert.equal(bahtText(101), 'หนึ่งร้อยเอ็ดบาทถ้วน');
  assert.equal(bahtText(1001), 'หนึ่งพันเอ็ดบาทถ้วน');
  assert.equal(bahtText(12), 'สิบสองบาทถ้วน');
  assert.equal(bahtText(222), 'สองร้อยยี่สิบสองบาทถ้วน');
  assert.equal(bahtText(4800), 'สี่พันแปดร้อยบาทถ้วน');
});

test('ล้าน (millions)', () => {
  assert.equal(bahtText(1_000_000), 'หนึ่งล้านบาทถ้วน');
  assert.equal(bahtText(1_000_001), 'หนึ่งล้านเอ็ดบาทถ้วน');
  assert.equal(bahtText(11_000_000), 'สิบเอ็ดล้านบาทถ้วน');
  assert.equal(bahtText(21_500_000), 'ยี่สิบเอ็ดล้านห้าแสนบาทถ้วน');
  assert.equal(bahtText(101_000_021), 'หนึ่งร้อยเอ็ดล้านยี่สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(1_000_000_000_000), 'หนึ่งล้านล้านบาทถ้วน');
});

console.log('\nInvoice lines');

const data: InvoiceData = {
  bill: {
    id: 'b1', invoice_no: 'INV202612000013', month: '2026-12-01', rent_month: '2026-12-01', usage_month: '2026-11-01',
    room_number: '403', rent: 4800, common_fee: 300, water_people: 2, water_per_person: 150, water_amount: 300,
    elec_prev: 7071, elec_curr: 7212, elec_units: 141, elec_amount: 1128, total: 11228, due_date: '2026-12-05',
    created_at: '2026-12-01T01:00:00Z', note: '', issued_by_name: 'Nok',
  },
  extras: [{ label: 'ค่าซ่อมแอร์ (Air-con repair)', amount: 4700 }],
  tenant: { full_name: 'Somchai Jaidee', address: '', phone: '0811111111' },
  dorm: {
    name: 'หอพักตัวอย่าง', name_en: 'Example Dorm', address: '', tax_id: '', phone: '085-000-0000', email: '', line_oa_id: '@exampledorm',
    invoice_note: '', bank_name: 'กสิกรไทย', bank_branch: 'สาทร', bank_account_name: 'Example Dorm', bank_account_number: '123-4-56789-0',
    promptpay_id: '0850000000', logo: null,
  },
};

test('lines match the reference: rent (rent month), common fee, water and electric (usage month), then extras', () => {
  assert.deepEqual(invoiceLines(data).map((l) => [l.no, l.text, l.amount]), [
    [1, 'ค่าเช่าห้อง (Room rate) 403 เดือน 12/2026', 4800],
    [2, 'ส่วนกลาง (300 บาท) (Common Fee (300 THB))', 300],
    [3, 'ค่าน้ำ (Water rate) เดือน 11/2026 (2 คน × 150)', 300],
    [4, 'ค่าไฟฟ้า (Electrical rate) เดือน 11/2026 (7212 - 7071 = 141 ยูนิต)', 1128],
    [5, 'ค่าซ่อมแอร์ (Air-con repair)', 4700],
  ]);
});

test('the common fee line uses the bill’s own stored value', () => {
  const l = invoiceLines({ ...data, bill: { ...data.bill, common_fee: 350 } });
  assert.equal(l[1].text, 'ส่วนกลาง (350 บาท) (Common Fee (350 THB))');
  assert.equal(l[1].amount, 350);
});

test('first bill: rent + common fee only; final bill: water + electric only', () => {
  const first = invoiceLines({ extras: [], bill: { ...data.bill, usage_month: null, water_amount: 0, elec_amount: 0 } });
  assert.deepEqual(first.map((l) => l.no + ' ' + l.text.split(' (')[0]), ['1 ค่าเช่าห้อง', '2 ส่วนกลาง']);
  const final = invoiceLines({ extras: [], bill: { ...data.bill, rent_month: null, rent: 0, common_fee: 0 } });
  assert.deepEqual(final.map((l) => l.no + ' ' + l.text.split(' (')[0]), ['1 ค่าน้ำ', '2 ค่าไฟฟ้า']);
});

test('decimal meter numbers and prices are shown as they are', () => {
  const l = invoiceLines({ extras: [], bill: { ...data.bill, elec_prev: 2000, elec_curr: 2150.7, elec_units: 150.7, water_per_person: 105.5 } });
  assert.equal(l[2].text, 'ค่าน้ำ (Water rate) เดือน 11/2026 (2 คน × 105.50)');
  assert.equal(l[3].text, 'ค่าไฟฟ้า (Electrical rate) เดือน 11/2026 (2150.7 - 2000 = 150.7 ยูนิต)');
});

test('footer: pay by the due day, bank, PromptPay, LINE and phone (Thai then English); empty settings left out', () => {
  const f = invoiceFooter(data);
  assert.equal(f[0], 'กรุณาชำระภายในวันที่ 1–5 ของทุกเดือน');
  assert.equal(f[1], 'Please pay between the 1st and the 5th of each month.');
  assert.equal(f[2], 'ธนาคารกสิกรไทย สาขาสาทร ชื่อบัญชี Example Dorm เลขที่บัญชี 123-4-56789-0');
  assert.ok(f.includes('พร้อมเพย์ (PromptPay): 0850000000'));
  assert.ok(f.includes('มีปัญหาการโอน แจ้งทาง LINE @exampledorm หรือ 085-000-0000'));
  const bare = invoiceFooter({ ...data, dorm: { ...data.dorm, bank_name: '', promptpay_id: '', line_oa_id: '', phone: '' } });
  assert.deepEqual(bare, ['กรุณาชำระภายในวันที่ 1–5 ของทุกเดือน', 'Please pay between the 1st and the 5th of each month.']);
  assert.equal(invoiceFooter({ ...data, bill: { ...data.bill, due_date: '2026-12-22' } })[1], 'Please pay between the 1st and the 22nd of each month.');
});

console.log('\nInvoice link tokens');

const sha = await hashToken('abc');
test('a token is 32 random bytes (43 base64url characters), different every time; only its SHA-256 is stored', () => {
  const a = newToken(), b = newToken();
  assert.ok(isToken(a) && isToken(b) && a !== b);
  assert.equal(sha, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(!isToken('x'.repeat(42)) && !isToken(a + '=') && !isToken('../' + a.slice(3)) && !isToken(null));
  assert.equal(invoiceUrl('https://dorm.example/', a), `https://dorm.example/#/i/${a}`);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all good'}`);
