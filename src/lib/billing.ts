/* Billing rules, as pure functions (no imports, so scripts/test-billing.ts can run it with plain `node`).
 *
 * The database function public.generate_bills() is what actually creates bills. This file
 * mirrors the same rules for the on-screen preview and for the unit test, so keep the two in step:
 *   current reading  = the room's monthly reading for the month (else its move-out reading in the month)
 *   previous reading = the latest reading before it (order: date, then move_out < move_in < monthly)
 *   rent             = the room's rent (rooms.default_rent)
 *   water            = the room's number of people x its water price per person (105 old / 150 new customer);
 *                      the water meter is not read
 *   electric         = (current - previous units) x electric rate, rounded to 2 decimals
 *                      (half away from zero, like Postgres round())
 *   total            = rent + water + electric + extra charges
 *   due date         = settings.due_day of the following month
 *
 * Money is computed in whole satang (1/100 baht) to avoid floating-point drift.
 */

export type ReadingKind = 'move_in' | 'monthly' | 'move_out';

export interface Reading {
  id: string;
  room_id: string;
  kind: string; // ReadingKind
  month: string; // 'YYYY-MM-01'
  read_on: string; // 'YYYY-MM-DD'
  water: number | null; // not read any more (migration 0007)
  electric: number;
  created_at: string;
}

export interface ContractLite {
  id: string;
  room_id: string;
  start_date: string;
  moved_out_on: string | null;
  monthly_rent: number;
  created_at: string;
}

export type Outcome = 'created' | 'already_billed' | 'no_contract' | 'no_reading' | 'no_previous_reading' | 'meter_backwards';

export interface RoomPrices {
  default_rent: number;
  water_per_person: number;
  occupants: number;
}

export interface BillLines {
  rent: number;
  waterPrev: number; waterCurr: number; waterUnits: number;
  waterPeople: number; waterPerPerson: number; waterAmount: number;
  elecPrev: number; elecCurr: number; elecUnits: number; elecRate: number; elecAmount: number;
  extrasTotal: number;
  total: number;
}

const KIND_RANK: Record<string, number> = { move_out: 0, move_in: 1, monthly: 2 };

/** Order readings the way the database does: date, then kind rank, then creation time. */
export function compareReadings(a: Reading, b: Reading): number {
  if (a.read_on !== b.read_on) return a.read_on < b.read_on ? -1 : 1;
  const ka = KIND_RANK[a.kind] ?? 2, kb = KIND_RANK[b.kind] ?? 2;
  if (ka !== kb) return ka - kb;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** The reading that closes the month for this room, or null. */
export function pickCurrent(roomReadings: Reading[], month: string): Reading | null {
  const inMonth = roomReadings.filter((r) => r.month === month && (r.kind === 'monthly' || r.kind === 'move_out'));
  if (inMonth.length === 0) return null;
  return [...inMonth].sort((a, b) => {
    const am = a.kind === 'monthly' ? 1 : 0, bm = b.kind === 'monthly' ? 1 : 0;
    if (am !== bm) return bm - am; // monthly first
    if (a.read_on !== b.read_on) return a.read_on > b.read_on ? -1 : 1; // newest first
    return a.created_at > b.created_at ? -1 : 1;
  })[0];
}

/** The latest reading strictly before `current`, or null. */
export function pickPrevious(roomReadings: Reading[], current: Reading): Reading | null {
  let best: Reading | null = null;
  for (const r of roomReadings) {
    if (r.id === current.id || compareReadings(r, current) >= 0) continue;
    if (!best || compareReadings(r, best) > 0) best = r;
  }
  return best;
}

/** Contract that counts for the month: active at some point during it; the latest start wins. */
export function pickContract(roomContracts: ContractLite[], month: string, monthEnd: string): ContractLite | null {
  const during = roomContracts.filter((c) => c.start_date <= monthEnd && (c.moved_out_on === null || c.moved_out_on >= month));
  if (during.length === 0) return null;
  return [...during].sort((a, b) =>
    a.start_date !== b.start_date ? (a.start_date > b.start_date ? -1 : 1) : (a.created_at > b.created_at ? -1 : 1))[0];
}

const tenths = (n: number) => Math.round(n * 10);
const satang = (n: number) => Math.round(n * 100);

/** units (1 decimal) x rate (2 decimals), rounded to satang. Returns satang. */
export function lineSatang(prev: number, curr: number, rate: number): number {
  const unitsTenths = tenths(curr) - tenths(prev);
  const raw = unitsTenths * satang(rate); // thousandths of a baht, an exact integer
  return Math.sign(raw) * Math.round(Math.abs(raw) / 10);
}

export function computeBill(input: {
  rent: number;
  waterPrev: number; waterCurr: number; waterPeople: number; waterPerPerson: number;
  elecPrev: number; elecCurr: number; elecRate: number;
  extras?: number[];
}): BillLines {
  const water = Math.round(input.waterPeople) * satang(input.waterPerPerson);
  const elec = lineSatang(input.elecPrev, input.elecCurr, input.elecRate);
  const extras = (input.extras ?? []).reduce((s, x) => s + satang(x), 0);
  const total = satang(input.rent) + water + elec + extras;
  return {
    rent: input.rent,
    waterPrev: input.waterPrev, waterCurr: input.waterCurr,
    waterUnits: (tenths(input.waterCurr) - tenths(input.waterPrev)) / 10,
    waterPeople: Math.round(input.waterPeople), waterPerPerson: input.waterPerPerson, waterAmount: water / 100,
    elecPrev: input.elecPrev, elecCurr: input.elecCurr,
    elecUnits: (tenths(input.elecCurr) - tenths(input.elecPrev)) / 10,
    elecRate: input.elecRate, elecAmount: elec / 100,
    extrasTotal: extras / 100,
    total: total / 100,
  };
}

export type PayStatus = 'paid' | 'partial' | 'unpaid';

/** Same rule as the bill_summary view. */
export function paymentStatus(total: number, payments: number[]): { paid: number; balance: number; status: PayStatus } {
  const paidS = payments.reduce((s, x) => s + satang(x), 0);
  const balanceS = satang(total) - paidS;
  const status: PayStatus = balanceS <= 0 ? 'paid' : paidS > 0 ? 'partial' : 'unpaid';
  return { paid: paidS / 100, balance: balanceS / 100, status };
}

/** settings.due_day of the month after `month` ('YYYY-MM-01'). */
export function dueDate(month: string, dueDay: number): string {
  const [y, m] = month.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
}

export interface PreviewRow {
  roomId: string;
  roomNumber: string;
  outcome: Outcome;
  contractId: string | null;
  lines: BillLines | null;
}

/** What "Generate all bills" will do for each room, without writing anything. */
export function previewMonth(args: {
  month: string;
  monthEnd: string;
  rooms: ({ id: string; number: string } & RoomPrices)[];
  contracts: ContractLite[];
  readings: Reading[];
  billedRoomIds: Set<string>;
  electricRate: number;
}): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const room of args.rooms) {
    const contract = pickContract(args.contracts.filter((c) => c.room_id === room.id), args.month, args.monthEnd);
    const base = { roomId: room.id, roomNumber: room.number, contractId: contract?.id ?? null, lines: null };
    if (!contract) { rows.push({ ...base, outcome: 'no_contract' }); continue; }
    if (args.billedRoomIds.has(room.id)) { rows.push({ ...base, outcome: 'already_billed' }); continue; }
    const rr = args.readings.filter((r) => r.room_id === room.id);
    const curr = pickCurrent(rr, args.month);
    if (!curr) { rows.push({ ...base, outcome: 'no_reading' }); continue; }
    const prev = pickPrevious(rr, curr);
    if (!prev) { rows.push({ ...base, outcome: 'no_previous_reading' }); continue; }
    if (Number(curr.electric) < Number(prev.electric)) {
      rows.push({ ...base, outcome: 'meter_backwards' }); continue;
    }
    rows.push({
      ...base,
      outcome: 'created',
      lines: computeBill({
        rent: Number(room.default_rent),
        waterPrev: 0, waterCurr: 0, // water meter not used
        waterPeople: Number(room.occupants), waterPerPerson: Number(room.water_per_person),
        elecPrev: Number(prev.electric), elecCurr: Number(curr.electric), elecRate: args.electricRate,
      }),
    });
  }
  return rows;
}
