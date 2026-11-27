/* Billing calculation tests. Run with:  npm run test:billing   (plain Node 22.18+ / 24, no extra packages)
 *
 * Billing period: the bill of month M has rent + common fee for M and electric/water for M-1.
 * Water is a flat price per person per month, chosen per room (105 old customer / 150 new customer).
 * The numbers match the database test supabase/tests/billing_period.test.sql (public.generate_bills()):
 *   December bill, room T961: Dec rent 4800 + common fee 300 + Nov water 2 x 150 = 300
 *                             + Nov electric 7071 -> 7212 = 141 units x 8 = 1128   TOTAL 6528
 *   first bill (moved in 10 Dec): 5000 + 300 = 5300
 *   final bill (moved out 15 Dec): 7212 -> 7300 = 88 units x 8 = 704 + water 300 = 1004
 * so this file checks that the on-screen preview and the database agree. */
import assert from 'node:assert/strict';
import {
  addMonth, billParts, computeBill, dueDate, lineSatang, paymentStatus, pickPrevious, pickUsageReading, previewMonth,
  type ContractLite, type Reading,
} from '../src/lib/billing.ts';
import { dashboardNumbers, defaultDashMonth, type DashBill } from '../src/lib/dashboard.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${(e as Error).message}`); process.exitCode = 1; }
}

const NOV = '2026-11-01', DEC = '2026-12-01', JAN = '2027-01-01';
const RATES = { electricRate: 8, commonFee: 300 };

let seq = 0;
const reading = (room_id: string, kind: string, read_on: string, electric: number, month = read_on.slice(0, 7) + '-01'): Reading => ({
  id: `r${++seq}`, room_id, kind, month, read_on, water: null, electric,
  created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
});
const contract = (id: string, room_id: string, start_date: string, monthly_rent: number, moved_out_on: string | null = null): ContractLite =>
  ({ id, room_id, start_date, moved_out_on, monthly_rent, created_at: start_date + 'T00:00:00Z' });
const room = (id: string, number: string, default_rent: number, water_per_person: number, occupants: number) =>
  ({ id, number, default_rent, water_per_person, occupants });

const rooms = [
  room('A', '403', 4800, 150, 2),   // the invoice example: 2 people x 150
  room('B', '102', 5500, 105, 1),   // old customer, 1 person
  room('C', '103', 5000, 150, 1),
  room('D', '204', 5500, 150, 1),
];
const contracts = [
  contract('cA', 'A', '2026-10-01', 4800),
  contract('cB', 'B', '2026-10-15', 5500),
  contract('cC', 'C', '2026-12-10', 5000),   // moves in during December: first bill
  contract('cD', 'D', '2026-10-01', 5500),   // no November reading
];
const readings = [
  reading('A', 'move_in', '2026-10-01', 7000), reading('A', 'monthly', '2026-10-31', 7071), reading('A', 'monthly', '2026-11-30', 7212),
  reading('B', 'move_in', '2026-10-15', 2000), reading('B', 'monthly', '2026-11-30', 2150.7),
  reading('C', 'move_in', '2026-12-10', 500),
  reading('D', 'move_in', '2026-10-01', 10),
];
const dec = previewMonth({ month: DEC, rooms, contracts, readings, billedContractIds: new Set(), ...RATES });
const byRoom = Object.fromEntries(dec.map((p) => [p.roomNumber, p]));

console.log('Billing period and common fee');

test('December bill = December rent + common fee + November electric/water (with the meter numbers)', () => {
  const p = byRoom['403'];
  assert.equal(p.outcome, 'created'); assert.equal(p.kind, 'regular');
  const l = p.lines!;
  assert.equal(l.rentMonth, DEC); assert.equal(l.usageMonth, NOV);
  assert.equal(l.rent, 4800); assert.equal(l.commonFee, 300);
  assert.equal(l.waterPeople, 2); assert.equal(l.waterPerPerson, 150); assert.equal(l.waterAmount, 300);
  assert.equal(l.elecPrev, 7071); assert.equal(l.elecCurr, 7212); assert.equal(l.elecUnits, 141); assert.equal(l.elecAmount, 1128);
  assert.equal(l.total, 6528);
});

test('old customer: 5500 + 300 + water 1×105 + elec 150.7u×8 = 1205.60 → 7,110.60; with a 200 extra → 7,310.60', () => {
  const l = byRoom['102'].lines!;
  assert.equal(l.waterAmount, 105); assert.equal(l.elecAmount, 1205.6); assert.equal(l.total, 7110.6);
  const withExtra = computeBill({ rent: 5500, commonFee: 300, waterPrev: 0, waterCurr: 0, waterPeople: 1, waterPerPerson: 105, elecPrev: 2000, elecCurr: 2150.7, elecRate: 8, extras: [200] });
  assert.equal(withExtra.extrasTotal, 200); assert.equal(withExtra.total, 7310.6);
});

test('first bill of a new contract: rent + common fee for the first month only, no usage, no reading needed', () => {
  const p = byRoom['103'];
  assert.equal(p.outcome, 'created'); assert.equal(p.kind, 'first');
  assert.equal(p.lines!.usageMonth, null); assert.equal(p.lines!.rentMonth, DEC);
  assert.equal(p.lines!.waterAmount, 0); assert.equal(p.lines!.elecAmount, 0);
  assert.equal(p.lines!.total, 5300);
});

test('final bill after move-out: usage only, up to the move-out reading (no rent, no common fee)', () => {
  const rr = [...readings.filter((r) => r.room_id === 'A'), reading('A', 'move_out', '2026-12-15', 7300)];
  const cs = [contract('cA', 'A', '2026-10-01', 4800, '2026-12-15')];
  const p = previewMonth({ month: JAN, rooms: [rooms[0]], contracts: cs, readings: rr, billedContractIds: new Set(), ...RATES });
  assert.equal(p.length, 1); assert.equal(p[0].kind, 'final'); assert.equal(p[0].outcome, 'created');
  const l = p[0].lines!;
  assert.equal(l.rentMonth, null); assert.equal(l.usageMonth, DEC);
  assert.equal(l.rent, 0); assert.equal(l.commonFee, 0);
  assert.equal(l.elecPrev, 7212); assert.equal(l.elecCurr, 7300); assert.equal(l.elecAmount, 704);
  assert.equal(l.waterAmount, 300); assert.equal(l.total, 1004);
  // and nothing after that
  assert.equal(previewMonth({ month: '2027-02-01', rooms: [rooms[0]], contracts: cs, readings: rr, billedContractIds: new Set(), ...RATES }).length, 0);
});

test('a room changing tenants in December: old tenant’s final bill and new tenant’s bill both in January', () => {
  const rr = [...readings.filter((r) => r.room_id === 'A'),
    reading('A', 'move_out', '2026-12-15', 7300), reading('A', 'move_in', '2026-12-20', 7300), reading('A', 'monthly', '2026-12-31', 7350)];
  const cs = [contract('cA', 'A', '2026-10-01', 4800, '2026-12-15'), contract('cE', 'A', '2026-12-20', 4800)];
  const decRows = previewMonth({ month: DEC, rooms: [rooms[0]], contracts: cs, readings: rr, billedContractIds: new Set(['cA']), ...RATES });
  assert.deepEqual(decRows.map((r) => [r.contractId, r.kind, r.outcome]), [['cA', 'regular', 'already_billed'], ['cE', 'first', 'created']]);
  const jan = previewMonth({ month: JAN, rooms: [rooms[0]], contracts: cs, readings: rr, billedContractIds: new Set(), ...RATES });
  assert.deepEqual(jan.map((r) => [r.contractId, r.kind, r.lines?.total]), [['cA', 'final', 1004], ['cE', 'regular', 4800 + 300 + 300 + 400]]);
  assert.equal(jan[1].lines!.elecPrev, 7300);   // from the new tenant's move-in reading
});

test('which parts a contract gets in a month', () => {
  const c = (start: string, out: string | null = null) => ({ start_date: start, moved_out_on: out });
  assert.deepEqual(billParts(c('2026-10-01'), DEC), { kind: 'regular', rent: true, usage: true });
  assert.deepEqual(billParts(c('2026-12-01'), DEC), { kind: 'first', rent: true, usage: false });   // starts on the 1st
  assert.deepEqual(billParts(c('2026-12-31'), DEC), { kind: 'first', rent: true, usage: false });
  assert.equal(billParts(c('2027-01-01'), DEC), null);                                              // not started yet
  assert.deepEqual(billParts(c('2026-10-01', '2026-12-15'), DEC)?.kind, 'regular');                // leaves later in Dec: Dec rent was due on the 1st
  assert.deepEqual(billParts(c('2026-10-01', '2026-11-30'), DEC)?.kind, 'final');
  assert.deepEqual(billParts(c('2026-10-01', '2026-12-01'), DEC)?.kind, 'final');                  // leaves on the 1st: no December rent
  assert.equal(billParts(c('2026-10-01', '2026-11-01'), DEC), null);                               // its final bill was November's
  assert.deepEqual(billParts(c('2026-12-05', '2026-12-20'), DEC)?.kind, 'first');                  // short stay: first bill ...
  assert.deepEqual(billParts(c('2026-12-05', '2026-12-20'), JAN)?.kind, 'final');                  // ... then the final one
  assert.equal(addMonth('2027-01-01', -1), '2026-12-01');
});

test('skip reasons: no reading for the usage month; already billed', () => {
  assert.equal(byRoom['204'].outcome, 'no_reading');
  const p = previewMonth({ month: DEC, rooms, contracts, readings, billedContractIds: new Set(['cA']), ...RATES });
  assert.equal(p.find((r) => r.contractId === 'cA')!.outcome, 'already_billed');
});

test('changing a room to the old-customer price changes the next bill’s water only for that room', () => {
  const cheaper = rooms.map((r) => (r.id === 'A' ? { ...r, water_per_person: 105 } : r));
  const p = previewMonth({ month: DEC, rooms: cheaper, contracts, readings, billedContractIds: new Set(), ...RATES });
  assert.equal(p.find((r) => r.roomNumber === '403')!.lines!.waterAmount, 210);
  assert.equal(p.find((r) => r.roomNumber === '102')!.lines!.waterAmount, 105);
});

test('a different common fee is used for bills made after the change', () => {
  const p = previewMonth({ month: DEC, rooms, contracts, readings, billedContractIds: new Set(), electricRate: 8, commonFee: 350 });
  assert.equal(p.find((r) => r.roomNumber === '403')!.lines!.total, 6578);
  assert.equal(p.find((r) => r.roomNumber === '103')!.lines!.total, 5350);
});

test('electric meter lower than last time is refused', () => {
  const rr = [reading('X', 'move_in', '2026-10-01', 500), reading('X', 'monthly', '2026-11-30', 499.9)];
  const p = previewMonth({ month: DEC, rooms: [room('X', '999', 1, 150, 1)], contracts: [contract('cX', 'X', '2026-10-01', 1)], readings: rr, billedContractIds: new Set(), ...RATES });
  assert.equal(p[0].outcome, 'meter_backwards');
});

test('no previous reading is refused', () => {
  const rr = [reading('Y', 'monthly', '2026-11-30', 5)];
  const p = previewMonth({ month: DEC, rooms: [room('Y', '998', 1, 150, 1)], contracts: [contract('cY', 'Y', '2026-10-01', 1)], readings: rr, billedContractIds: new Set(), ...RATES });
  assert.equal(p[0].outcome, 'no_previous_reading');
});

test('a reading saved while the room was vacant does not bill anyone', () => {
  const rr = [reading('V', 'monthly', '2026-11-30', 4321)];
  assert.equal(previewMonth({ month: DEC, rooms: [room('V', '996', 1000, 150, 1)], contracts: [], readings: rr, billedContractIds: new Set(), ...RATES }).length, 0);
});

test('same-day order: new tenant’s move-in comes after old tenant’s move-out', () => {
  const out = reading('Z', 'move_out', '2026-11-10', 300);
  const inn = reading('Z', 'move_in', '2026-11-10', 300);
  const mon = reading('Z', 'monthly', '2026-11-30', 350);
  const rr = [mon, inn, out];
  assert.equal(pickUsageReading(rr, { moved_out_on: null }, 'regular', NOV)!.id, mon.id);
  assert.equal(pickUsageReading(rr, { moved_out_on: '2026-11-10' }, 'final', NOV)!.id, out.id);
  assert.equal(pickPrevious(rr, mon)!.id, inn.id);
});

test('rounding matches Postgres round(x, 2): half away from zero, no float drift', () => {
  assert.equal(lineSatang(0, 0.1, 0.05), 1);         // 0.005 → 0.01
  assert.equal(lineSatang(0, 3.3, 7.35), 2426);      // 24.255 → 24.26
  assert.equal(lineSatang(100, 100.7, 4.45), 312);   // 3.115 → 3.12
  assert.equal(computeBill({ rent: 0.1, commonFee: 0.2, waterPrev: 0, waterCurr: 0, waterPeople: 0, waterPerPerson: 0, elecPrev: 0, elecCurr: 0, elecRate: 0, extras: [0.2] }).total, 0.5);
});

test('payments: partial and full, against the total that includes the common fee', () => {
  assert.deepEqual(paymentStatus(6528, [3000]), { paid: 3000, balance: 3528, status: 'partial' });
  assert.deepEqual(paymentStatus(6528, [3000, 3528]), { paid: 6528, balance: 0, status: 'paid' });
  assert.deepEqual(paymentStatus(6528, [6228]).status, 'partial');   // paying the total without the common fee is not enough
});

test('due date is settings.due_day of the bill month', () => {
  assert.equal(dueDate('2026-12-01', 5), '2026-12-05');
  assert.equal(dueDate('2027-01-01', 5), '2027-01-05');
});

test('dashboard: 3 example bills (one partly paid) give the right expected / collected / outstanding', () => {
  // Totals include the common fee (bill_summary.total). 403 paid in full, 102 unpaid and overdue, 103 partly paid.
  const bill = (room: string, total: number, paid: number, overdue: boolean): DashBill => ({
    room_id: room, room_number: room, tenant_name: `T${room}`, month: DEC, total, paid,
    balance: Math.round((total - paid) * 100) / 100, is_overdue: overdue, due_date: '2026-12-05',
  });
  const bills = [bill('403', 6528, 6528, false), bill('102', 7110.6, 0, true), bill('103', 5300, 3000, true),
    { ...bill('103', 1000, 0, true), month: NOV, due_date: '2026-11-05' }];
  const rs = [{ id: '403', number: '403', status: 'occupied' }, { id: '102', number: '102', status: 'occupied' },
    { id: '103', number: '103', status: 'occupied' }, { id: '104', number: '104', status: 'vacant' }];
  const n = dashboardNumbers(rs, bills, DEC);
  assert.equal(n.occupancy, 0.75);
  assert.equal(n.billsInMonth, 3);
  assert.equal(n.expected, 18938.6);               // 6528 + 7110.60 + 5300
  assert.equal(n.collected, 9528);                 // 6528 + 3000
  assert.equal(n.outstanding, 10410.6);            // 7110.60 + 2300 + 1000 (November)
  assert.deepEqual(n.overdue.map((r) => [r.roomNumber, r.bills, r.amount, r.oldestDue]),
    [['103', 2, 3300, '2026-11-05'], ['102', 1, 7110.6, '2026-12-05']]);
  assert.equal(defaultDashMonth(bills, '2027-01-01'), DEC);   // no January bills yet -> December
  assert.equal(defaultDashMonth([], DEC), DEC);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all good'}`);
