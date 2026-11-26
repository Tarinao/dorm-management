/* Reservation and maintenance rules, the same as the database enforces in
 * supabase/migrations/20261126101653_reservations_maintenance.sql (assert_room_reservable,
 * natural_room_status, the triggers). Used by the app to show WHY a room cannot be reserved
 * before anyone presses a button, and by scripts/test-reservations.ts. The database stays the
 * judge: these only predict its answer. Pure (no imports). */

export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'moved_in';
export const RESERVATION_STATUSES: readonly ReservationStatus[] = ['pending', 'confirmed', 'cancelled', 'expired', 'moved_in'];
export const ACTIVE: readonly ReservationStatus[] = ['pending', 'confirmed'];
export const isActive = (s: string) => s === 'pending' || s === 'confirmed';

export type TicketStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export const TICKET_OPEN = (s: string) => s === 'open' || s === 'in_progress';

export interface RuleRoom { id: string; status: string }
export interface RuleContract { room_id: string; status: string; end_date: string | null }
export interface RuleReservation { id: string; room_id: string | null; status: string }
export interface RuleTicket { room_id: string; status: string; block_room: boolean }

/** Error codes, the same strings the database raises. */
export type Blocker =
  | 'ROOM_ALREADY_RESERVED' | 'ROOM_IN_MAINTENANCE' | 'ROOM_NO_MOVE_OUT_DATE' | 'MOVE_IN_BEFORE_MOVE_OUT';

/** Why a reservation (for `desired` move-in) cannot be active on this room; null = allowed.
 *  `self` is the reservation being saved (it never blocks itself). */
export function reservationBlocker(
  room: RuleRoom, desired: string, data: { contracts: RuleContract[]; reservations: RuleReservation[]; tickets: RuleTicket[] }, self: string | null = null,
): Blocker | null {
  if (data.reservations.some((r) => r.room_id === room.id && isActive(r.status) && r.id !== self)) return 'ROOM_ALREADY_RESERVED';
  if (room.status === 'maintenance' || data.tickets.some((t) => t.room_id === room.id && t.block_room && TICKET_OPEN(t.status))) {
    return 'ROOM_IN_MAINTENANCE';
  }
  if (room.status === 'occupied') {
    const c = data.contracts.find((x) => x.room_id === room.id && x.status === 'active');
    if (!c?.end_date) return 'ROOM_NO_MOVE_OUT_DATE';
    if (desired < c.end_date) return 'MOVE_IN_BEFORE_MOVE_OUT';
  }
  if (room.status === 'reserved' && !data.reservations.some((r) => r.id === self && r.room_id === room.id && r.status === 'confirmed')) {
    return 'ROOM_ALREADY_RESERVED';
  }
  return null;
}

/** The status a room goes back to when a booking or a blocking ticket lets go of it. */
export function naturalRoomStatus(roomId: string, data: { contracts: RuleContract[]; reservations: RuleReservation[]; tickets: RuleTicket[] }): string {
  if (data.contracts.some((c) => c.room_id === roomId && c.status === 'active')) return 'occupied';
  if (data.tickets.some((t) => t.room_id === roomId && t.block_room && TICKET_OPEN(t.status))) return 'maintenance';
  if (data.reservations.some((r) => r.room_id === roomId && r.status === 'confirmed')) return 'reserved';
  return 'vacant';
}

/** expires_on default: 7 days after the desired move-in ('YYYY-MM-DD'). */
export function defaultExpiry(desired: string): string {
  const d = new Date(desired.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** Deposit still to collect at move-in when a paid booking fee counts toward it. */
export function depositDue(deposit: number, bookingFeeCredit: number): number {
  return Math.max(0, Math.round((deposit - bookingFeeCredit) * 100) / 100);
}

/** Maintenance list order: urgent first, then normal, then low; oldest first within each. */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, normal: 1, low: 2 };
export function ticketOrder(a: { status: string; priority: string; opened_at: string }, b: { status: string; priority: string; opened_at: string }): number {
  const openA = TICKET_OPEN(a.status) ? 0 : 1, openB = TICKET_OPEN(b.status) ? 0 : 1;
  if (openA !== openB) return openA - openB;
  if (openA === 0) {
    const p = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (p) return p;
    return a.opened_at.localeCompare(b.opened_at);
  }
  return b.opened_at.localeCompare(a.opened_at);   // closed: newest first
}
