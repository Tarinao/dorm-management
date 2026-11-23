/* Billing calculation tests. Run with:  npm run test:billing   (plain Node 22.18+ / 24, no extra packages)
 *
 * Water is a flat price per person per month, chosen per room (105 old customer / 150 new customer).
 * The three example rooms are the same ones used in the database rehearsal of migration 0006
 * (public.generate_bills()), whose results were:
 *   101 rent=6000 water=2 x 105 = 210  elec=987.20   TOTAL=7197.20
 *   102 rent=5500 water=1 x 150 = 150  elec=1205.60  TOTAL=6855.60
 *   103 rent=4800 water=3 x 150 = 450  elec=799.20   TOTAL=6049.20
 * so this file checks that the on-screen preview and the database agree. */
import assert from 'node:assert/strict';
import {
  computeBill, dueDate, lineSatang, paymentStatus, pickCurrent, pickPrevious, previewMonth,
  type ContractLite, type Reading,
} from '../src/lib/billing.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${(e as Error).message}`); process.exitCode = 1; }
}

const NOV = '2026-11-01', NOV_END = '2026-11-30';
const RATES = { electricRate: 8 };

let seq = 0;
const reading = (room_id: string, kind: string, read_on: string, water: number, electric: number): Reading => ({
  id: `r${++seq}`, room_id, kind, month: read_on.slice(0, 7) + '-01', read_on, water, electric,
  created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
});
const contract = (id: string, room_id: string, start_date: string, monthly_rent: number, moved_out_on: string | null = null): ContractLite =>
  ({ id, room_id, start_date, moved_out_on, monthly_rent, created_at: start_date + 'T00:00:00Z' });

const room = (id: string, number: string, default_rent: number, water_per_person: number, occupants: number) =>
  ({ id, number, default_rent, water_per_person, occupants });
const rooms = [
  room('A', '101', 6000, 105, 2),   // old customer, 2 people
  room('B', '102', 5500, 150, 1),   // new customer, 1 person
  room('C', '103', 4800, 150, 3),   // rent changed on the Billing page to 4800, 3 people
  room('D', '204', 5500, 150, 1),
  room('E', '205', 4000, 150, 1),
];
const contracts = [
  contract('cA', 'A', '2026-10-01', 6000),
  contract('cB', 'B', '2026-10-15', 5500),
  contract('cC', 'C', '2026-10-01', 4500),
  contract('cD', 'D', '2026-10-01', 5500),
];
const readings = [
  reading('A', 'move_in', '2026-10-01', 100.0, 1000.0), reading('A', 'monthly', '2026-11-30', 112.5, 1123.4),
  reading('B', 'move_in', '2026-10-15', 50.0, 2000.0), reading('B', 'monthly', '2026-11-30', 58.3, 2150.7),
  reading('C', 'move_in', '2026-10-01', 0, 0), reading('C', 'monthly', '2026-11-30', 7.7, 99.9),
  reading('D', 'move_in', '2026-10-01', 10, 10), // no November reading
];

console.log('Billing calculation');

const preview = previewMonth({ month: NOV, monthEnd: NOV_END, rooms, contracts, readings, billedRoomIds: new Set(), ...RATES });
const byRoom = Object.fromEntries(preview.map((p) => [p.roomNumber, p]));

test('room 101 (old customer, 2 people): 6000 + water 2×105 = 210.00 + elec 123.4u×8 = 987.20 → 7,197.20', () => {
  const l = byRoom['101'].lines!;
  assert.equal(byRoom['101'].outcome, 'created');
  assert.equal(l.waterPeople, 2); assert.equal(l.waterPerPerson, 105); assert.equal(l.waterAmount, 210);
  assert.equal(l.waterUnits, 0); // water meter is not read (migration 0007)
  assert.equal(l.elecUnits, 123.4); assert.equal(l.elecAmount, 987.2);
  assert.equal(l.total, 7197.2);
});

test('room 102 (new customer, 1 person): 5500 + 150 + 1205.60 → 6,855.60; with a 300 extra → 7,155.60', () => {
  const p = byRoom['102'];
  assert.equal(p.outcome, 'created');
  assert.equal(p.lines!.waterAmount, 150); assert.equal(p.lines!.elecAmount, 1205.6);
  assert.equal(p.lines!.total, 6855.6);
  const withExtra = computeBill({ rent: 5500, waterPrev: 50, waterCurr: 58.3, waterPeople: 1, waterPerPerson: 150, elecPrev: 2000, elecCurr: 2150.7, elecRate: 8, extras: [300] });
  assert.equal(withExtra.extrasTotal, 300); assert.equal(withExtra.total, 7155.6);
});

test('room 103 (rent 4800, 3 people × 150) with a partial payment: 6,049.20, paid 3,000 → balance 3,049.20, partial', () => {
  const l = byRoom['103'].lines!;
  assert.equal(l.rent, 4800); assert.equal(l.waterAmount, 450); assert.equal(l.elecAmount, 799.2); assert.equal(l.total, 6049.2);
  assert.deepEqual(paymentStatus(l.total, [3000]), { paid: 3000, balance: 3049.2, status: 'partial' });
  assert.deepEqual(paymentStatus(l.total, [3000, 3049.2]), { paid: 6049.2, balance: 0, status: 'paid' });
  assert.deepEqual(paymentStatus(l.total, []), { paid: 0, balance: 6049.2, status: 'unpaid' });
});

test('changing a room to the old-customer price changes next month’s water only for that room', () => {
  const cheaper = rooms.map((r) => (r.id === 'B' ? { ...r, water_per_person: 105 } : r));
  const p = previewMonth({ month: NOV, monthEnd: NOV_END, rooms: cheaper, contracts, readings, billedRoomIds: new Set(), ...RATES });
  assert.equal(p.find((r) => r.roomNumber === '102')!.lines!.waterAmount, 105);
  assert.equal(p.find((r) => r.roomNumber === '101')!.lines!.waterAmount, 210);
});

test('skip reasons: 204 has no reading this month, 205 has no tenant', () => {
  assert.equal(byRoom['204'].outcome, 'no_reading');
  assert.equal(byRoom['205'].outcome, 'no_contract');
});

test('already billed rooms are skipped', () => {
  const p = previewMonth({ month: NOV, monthEnd: NOV_END, rooms, contracts, readings, billedRoomIds: new Set(['A']), ...RATES });
  assert.equal(p.find((r) => r.roomNumber === '101')!.outcome, 'already_billed');
});

test('electric meter lower than last time is refused', () => {
  const rr = [reading('X', 'move_in', '2026-10-01', 0, 500), reading('X', 'monthly', '2026-11-30', 0, 499.9)];
  const p = previewMonth({ month: NOV, monthEnd: NOV_END, rooms: [room('X', '999', 1, 150, 1)], contracts: [contract('cX', 'X', '2026-10-01', 1)], readings: rr, billedRoomIds: new Set(), ...RATES });
  assert.equal(p[0].outcome, 'meter_backwards');
});

test('water meter is ignored: an empty or lower water reading does not block the bill', () => {
  const rr = [reading('W', 'move_in', '2026-10-01', 50, 500), { ...reading('W', 'monthly', '2026-11-30', 0, 600), water: null }];
  const p = previewMonth({ month: NOV, monthEnd: NOV_END, rooms: [room('W', '997', 1000, 105, 1)], contracts: [contract('cW', 'W', '2026-10-01', 1000)], readings: rr, billedRoomIds: new Set(), ...RATES });
  assert.equal(p[0].outcome, 'created');
  assert.equal(p[0].lines!.total, 1000 + 105 + 800);
});

test('a reading saved while the room was vacant does not bill anyone', () => {
  const rr = [reading('V', 'monthly', '2026-11-30', 0, 4321)];
  const p = previewMonth({ month: NOV, monthEnd: NOV_END, rooms: [room('V', '996', 1000, 150, 1)], contracts: [], readings: rr, billedRoomIds: new Set(), ...RATES });
  assert.equal(p[0].outcome, 'no_contract');
});

test('no previous reading is refused', () => {
  const rr = [reading('Y', 'monthly', '2026-11-30', 5, 5)];
  const p = previewMonth({ month: NOV, monthEnd: NOV_END, rooms: [room('Y', '998', 1, 150, 1)], contracts: [contract('cY', 'Y', '2026-10-01', 1)], readings: rr, billedRoomIds: new Set(), ...RATES });
  assert.equal(p[0].outcome, 'no_previous_reading');
});

test('December after move-out: final bill uses the move-out reading (same as DB rehearsal)', () => {
  const rr = [...readings.filter((r) => r.room_id === 'B'), reading('B', 'move_out', '2026-12-15', 61.0, 2200.0)];
  const cs = [contract('cB', 'B', '2026-10-15', 5500, '2026-12-15')];
  const p = previewMonth({ month: '2026-12-01', monthEnd: '2026-12-31', rooms: [rooms[1]], contracts: cs, readings: rr, billedRoomIds: new Set(), ...RATES });
  assert.equal(p[0].outcome, 'created');
  assert.equal(p[0].lines!.waterAmount, 150);   // 1 person × 150
  assert.equal(p[0].lines!.elecAmount, 394.4);  // 49.3 × 8
  assert.equal(p[0].lines!.total, 6044.4);
});

test('same-day order: new tenant’s move-in comes after old tenant’s move-out', () => {
  const out = reading('Z', 'move_out', '2026-11-10', 30, 300);
  const inn = reading('Z', 'move_in', '2026-11-10', 30, 300);
  const mon = reading('Z', 'monthly', '2026-11-30', 35, 350);
  const rr = [mon, inn, out];
  assert.equal(pickCurrent(rr, NOV)!.id, mon.id);
  assert.equal(pickPrevious(rr, mon)!.id, inn.id);
});

test('rounding matches Postgres round(x, 2): half away from zero, no float drift', () => {
  assert.equal(lineSatang(0, 0.1, 0.05), 1);         // 0.005 → 0.01
  assert.equal(lineSatang(0, 3.3, 7.35), 2426);      // 24.255 → 24.26
  assert.equal(lineSatang(100, 100.7, 4.45), 312);   // 3.115 → 3.12
  assert.equal(computeBill({ rent: 0.1, waterPrev: 0, waterCurr: 0, waterPeople: 0, waterPerPerson: 0, elecPrev: 0, elecCurr: 0, elecRate: 0, extras: [0.2] }).total, 0.3);
});

test('due date is settings.due_day of the following month (also across the year end)', () => {
  assert.equal(dueDate('2026-11-01', 5), '2026-12-05');
  assert.equal(dueDate('2026-12-01', 5), '2027-01-05');
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ', all good'}`);
