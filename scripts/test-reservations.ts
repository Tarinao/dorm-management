/* Reservation / maintenance rules as the app predicts them (src/lib/reservations.ts). The same rules
 * are enforced by the database; supabase/tests/reservations_maintenance.test.sql checks those on a
 * real Postgres. Run: npm run test:reservations */
import {
  defaultExpiry, depositDue, naturalRoomStatus, reservationBlocker, ticketOrder,
  type RuleContract, type RuleReservation, type RuleTicket,
} from '../src/lib/reservations.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`); }
}
function eq<T>(actual: T, expected: T, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const world = (x: { contracts?: RuleContract[]; reservations?: RuleReservation[]; tickets?: RuleTicket[] } = {}) =>
  ({ contracts: x.contracts ?? [], reservations: x.reservations ?? [], tickets: x.tickets ?? [] });
const vacant = { id: 'A', status: 'vacant' };

console.log('Double booking');
test('a vacant room with no booking can be reserved', () => eq(reservationBlocker(vacant, '2026-12-01', world()), null));
test('a second active booking on the same room is refused (pending or confirmed)', () => {
  for (const status of ['pending', 'confirmed']) {
    eq(reservationBlocker(vacant, '2026-12-01', world({ reservations: [{ id: 'r1', room_id: 'A', status }] })), 'ROOM_ALREADY_RESERVED', status);
  }
});
test('closed bookings (cancelled / expired / moved in) do not block', () => {
  const reservations = ['cancelled', 'expired', 'moved_in'].map((status, i) => ({ id: `r${i}`, room_id: 'A', status }));
  eq(reservationBlocker(vacant, '2026-12-01', world({ reservations })), null);
});
test('a booking does not block itself when edited', () =>
  eq(reservationBlocker(vacant, '2026-12-01', world({ reservations: [{ id: 'r1', room_id: 'A', status: 'pending' }] }), 'r1'), null));
test('a booking on ANOTHER room does not block', () =>
  eq(reservationBlocker(vacant, '2026-12-01', world({ reservations: [{ id: 'r1', room_id: 'B', status: 'confirmed' }] })), null));
test('a LINE request without a room does not block any room', () =>
  eq(reservationBlocker(vacant, '2026-12-01', world({ reservations: [{ id: 'r1', room_id: null, status: 'pending' }] })), null));
test('a room set to "reserved" is refused, except for the confirmed booking that holds it', () => {
  const room = { id: 'A', status: 'reserved' };
  eq(reservationBlocker(room, '2026-12-01', world()), 'ROOM_ALREADY_RESERVED', 'reserved by hand');
  eq(reservationBlocker(room, '2026-12-01', world({ reservations: [{ id: 'r1', room_id: 'A', status: 'confirmed' }] }), 'r1'), null, 'its own booking');
});

console.log('Occupied rooms');
const occupied = { id: 'A', status: 'occupied' };
test('occupied with no move-out date: refused', () =>
  eq(reservationBlocker(occupied, '2027-01-01', world({ contracts: [{ room_id: 'A', status: 'active', end_date: null }] })), 'ROOM_NO_MOVE_OUT_DATE'));
test('occupied with a move-out date: allowed from that date on', () => {
  const w = world({ contracts: [{ room_id: 'A', status: 'active', end_date: '2026-12-31' }] });
  eq(reservationBlocker(occupied, '2026-12-30', w), 'MOVE_IN_BEFORE_MOVE_OUT');
  eq(reservationBlocker(occupied, '2026-12-31', w), null);
  eq(reservationBlocker(occupied, '2027-01-15', w), null);
});

console.log('Maintenance');
test('a room in maintenance cannot be reserved', () => eq(reservationBlocker({ id: 'A', status: 'maintenance' }, '2026-12-01', world()), 'ROOM_IN_MAINTENANCE'));
test('an open "block room" ticket blocks; a closed or non-blocking one does not', () => {
  eq(reservationBlocker(vacant, '2026-12-01', world({ tickets: [{ room_id: 'A', status: 'open', block_room: true }] })), 'ROOM_IN_MAINTENANCE');
  eq(reservationBlocker(vacant, '2026-12-01', world({ tickets: [{ room_id: 'A', status: 'in_progress', block_room: true }] })), 'ROOM_IN_MAINTENANCE');
  eq(reservationBlocker(vacant, '2026-12-01', world({ tickets: [{ room_id: 'A', status: 'done', block_room: true }] })), null);
  eq(reservationBlocker(vacant, '2026-12-01', world({ tickets: [{ room_id: 'A', status: 'open', block_room: false }] })), null);
});

console.log('Room status after a booking or ticket lets go');
test('active contract > blocking ticket > confirmed booking > vacant', () => {
  const c = [{ room_id: 'A', status: 'active', end_date: null }];
  const tk = [{ room_id: 'A', status: 'open', block_room: true }];
  const r = [{ id: 'r', room_id: 'A', status: 'confirmed' }];
  eq(naturalRoomStatus('A', world({ contracts: c, tickets: tk, reservations: r })), 'occupied');
  eq(naturalRoomStatus('A', world({ tickets: tk, reservations: r })), 'maintenance');
  eq(naturalRoomStatus('A', world({ reservations: r })), 'reserved');
  eq(naturalRoomStatus('A', world({ reservations: [{ id: 'r', room_id: 'A', status: 'cancelled' }] })), 'vacant');
});

console.log('Dates, deposit, ordering');
test('expiry defaults to 7 days after the move-in date (also across months / years)', () => {
  eq(defaultExpiry('2026-12-01'), '2026-12-08');
  eq(defaultExpiry('2026-12-28'), '2027-01-04');
  eq(defaultExpiry('2028-02-25'), '2028-03-03');
});
test('a paid booking fee counts toward the deposit', () => {
  eq(depositDue(6000, 2000), 4000);
  eq(depositDue(6000, 0), 6000);
  eq(depositDue(1500, 2000), 0, 'never below zero');
  eq(depositDue(5000.1, 0.2), 4999.9);
});
test('maintenance list: open first, urgent on top, then oldest; closed newest first', () => {
  const list = [
    { id: 'closed-old', status: 'done', priority: 'urgent', opened_at: '2026-10-01' },
    { id: 'normal-old', status: 'open', priority: 'normal', opened_at: '2026-11-01' },
    { id: 'urgent-new', status: 'in_progress', priority: 'urgent', opened_at: '2026-11-20' },
    { id: 'low', status: 'open', priority: 'low', opened_at: '2026-10-15' },
    { id: 'closed-new', status: 'cancelled', priority: 'normal', opened_at: '2026-11-10' },
    { id: 'normal-new', status: 'open', priority: 'normal', opened_at: '2026-11-15' },
  ];
  eq([...list].sort(ticketOrder).map((x) => x.id), ['urgent-new', 'normal-old', 'normal-new', 'low', 'closed-new', 'closed-old']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
