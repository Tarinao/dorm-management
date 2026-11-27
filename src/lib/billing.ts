/* Billing rules, as pure functions (no imports, so scripts/test-billing.ts can run it with plain `node`).
 *
 * The database function public.generate_bills() is what actually creates bills. This file
 * mirrors the same rules for the on-screen preview and for the unit test, so keep the two in step.
 *
 * Billing period. The bill made on the 1st of month M (bill month M) has
 *   rent + common fee for M, in advance                  (rent month  = M)
 *   electric + water for M-1, from the M-1 readings       (usage month = M-1)
 * per contract:
 *   rent + common fee  when the contract lives in M:     start <= end of M and (no move-out, or move-out after the 1st of M)
 *   usage of M-1       when it was there before M began: start before the 1st of M (and had not left by the 1st of M-1)
 *   -> regular bill (both), first bill (rent only: the contract starts in M),
 *      final bill (usage only: it moved out during M-1, or on the 1st of M)
 *   current reading  = the move-out reading for a final bill, else the room's monthly reading for M-1
 *   previous reading = the latest reading before it (order: date, then move_out < move_in < monthly)
 *   rent             = the room's rent (rooms.default_rent)
 *   common fee       = settings.common_fee, copied onto the bill when it is made
 *   water            = the room's number of people x its water price per person (105 old / 150 new customer)
 *   electric         = (current - previous units) x electric rate, rounded to 2 decimals
 *                      (half away from zero, like Postgres round())
 *   total            = rent + common fee + water + electric + extra charges
 *   due date         = settings.due_day of the bill month M
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

export type Outcome = 'created' | 'already_billed' | 'no_reading' | 'no_previous_reading' | 'meter_backwards';
export type BillKind = 'regular' | 'first' | 'final';

export interface RoomPrices {
  default_rent: number;
  water_per_person: number;
  occupants: number;
}

export interface BillLines {
  kind: BillKind;
  rentMonth: string | null;   // 'YYYY-MM-01'; null on a final bill
  usageMonth: string | null;  // 'YYYY-MM-01'; null on a first bill
  rent: number;
  commonFee: number;
  waterPrev: number; waterCurr: number; waterUnits: number;
  waterPeople: number; waterPerPerson: number; waterAmount: number;
  elecPrev: number; elecCurr: number; elecUnits: number; elecRate: number; elecAmount: number;
  extrasTotal: number;
  total: number;
}

const KIND_RANK: Record<string, number> = { move_out: 0, move_in: 1, monthly: 2 };

/** 'YYYY-MM-01' plus n months. */
export function addMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/** Last day of the month, 'YYYY-MM-DD'. */
export function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Order readings the way the database does: date, then kind rank, then creation time. */
export function compareReadings(a: Reading, b: Reading): number {
  if (a.read_on !== b.read_on) return a.read_on < b.read_on ? -1 : 1;
  const ka = KIND_RANK[a.kind] ?? 2, kb = KIND_RANK[b.kind] ?? 2;
  if (ka !== kb) return ka - kb;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/** Contract that lives in the room during the month (Meters page): active at some point during
 *  it; the latest start wins. */
export function pickContract(roomContracts: ContractLite[], month: string, monthEnd: string): ContractLite | null {
  const during = roomContracts.filter((c) => c.start_date <= monthEnd && (c.moved_out_on === null || c.moved_out_on >= month));
  if (during.length === 0) return null;
  return [...during].sort((a, b) =>
    a.start_date !== b.start_date ? (a.start_date > b.start_date ? -1 : 1) : (a.created_at > b.created_at ? -1 : 1))[0];
}

/** What the bill of month M has for this contract: rent (+ common fee), usage of M-1, both, or
 *  nothing (null: the contract is not billed in M). */
export function billParts(c: Pick<ContractLite, 'start_date' | 'moved_out_on'>, month: string): { kind: BillKind; rent: boolean; usage: boolean } | null {
  const usageMonth = addMonth(month, -1);
  if (c.start_date > lastDay(month)) return null;
  if (c.moved_out_on !== null && c.moved_out_on <= usageMonth) return null;
  const rent = c.moved_out_on === null || c.moved_out_on > month;
  const usage = c.start_date < month;
  if (!rent && !usage) return null;
  return { kind: rent && usage ? 'regular' : rent ? 'first' : 'final', rent, usage };
}

/** The reading that closes the usage month for this contract, or null:
 *  its move-out reading on a final bill, else the room's monthly reading for the usage month. */
export function pickUsageReading(roomReadings: Reading[], c: Pick<ContractLite, 'moved_out_on'>, kind: BillKind, usageMonth: string): Reading | null {
  const found = kind === 'final'
    ? roomReadings.filter((r) => r.kind === 'move_out' && r.read_on === c.moved_out_on)
    : roomReadings.filter((r) => r.kind === 'monthly' && r.month === usageMonth);
  if (found.length === 0) return null;
  return [...found].sort((a, b) => (a.created_at > b.created_at ? -1 : 1))[0];
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

const tenths = (n: number) => Math.round(n * 10);
const satang = (n: number) => Math.round(n * 100);

/** units (1 decimal) x rate (2 decimals), rounded to satang. Returns satang. */
export function lineSatang(prev: number, curr: number, rate: number): number {
  const unitsTenths = tenths(curr) - tenths(prev);
  const raw = unitsTenths * satang(rate); // thousandths of a baht, an exact integer
  return Math.sign(raw) * Math.round(Math.abs(raw) / 10);
}

export function computeBill(input: {
  kind?: BillKind; rentMonth?: string | null; usageMonth?: string | null;
  rent: number; commonFee?: number;
  waterPrev: number; waterCurr: number; waterPeople: number; waterPerPerson: number;
  elecPrev: number; elecCurr: number; elecRate: number;
  extras?: number[];
}): BillLines {
  const water = Math.round(input.waterPeople) * satang(input.waterPerPerson);
  const elec = lineSatang(input.elecPrev, input.elecCurr, input.elecRate);
  const common = satang(input.commonFee ?? 0);
  const extras = (input.extras ?? []).reduce((s, x) => s + satang(x), 0);
  const total = satang(input.rent) + common + water + elec + extras;
  return {
    kind: input.kind ?? 'regular', rentMonth: input.rentMonth ?? null, usageMonth: input.usageMonth ?? null,
    rent: input.rent, commonFee: common / 100,
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

/** settings.due_day of the bill month ('YYYY-MM-01'). */
export function dueDate(month: string, dueDay: number): string {
  return `${month.slice(0, 8)}${String(dueDay).padStart(2, '0')}`;
}

export interface PreviewRow {
  roomId: string;
  roomNumber: string;
  contractId: string;
  kind: BillKind;
  outcome: Outcome;
  lines: BillLines | null;
}

/** What "Generate all bills" will do for each contract in bill month `month`, without writing anything. */
export function previewMonth(args: {
  month: string;
  rooms: ({ id: string; number: string } & RoomPrices)[];
  contracts: ContractLite[];
  readings: Reading[];
  billedContractIds: Set<string>;
  electricRate: number;
  commonFee: number;
}): PreviewRow[] {
  const usageMonth = addMonth(args.month, -1);
  const roomById = new Map(args.rooms.map((r) => [r.id, r]));
  const rows: PreviewRow[] = [];
  const contracts = [...args.contracts].sort((a, b) => {
    const ra = roomById.get(a.room_id)?.number ?? '', rb = roomById.get(b.room_id)?.number ?? '';
    return ra.localeCompare(rb, undefined, { numeric: true }) || a.start_date.localeCompare(b.start_date) || a.created_at.localeCompare(b.created_at);
  });
  for (const c of contracts) {
    const room = roomById.get(c.room_id);
    const parts = room ? billParts(c, args.month) : null;
    if (!room || !parts) continue;
    const base = { roomId: room.id, roomNumber: room.number, contractId: c.id, kind: parts.kind, lines: null };
    if (args.billedContractIds.has(c.id)) { rows.push({ ...base, outcome: 'already_billed' }); continue; }

    let prev: Reading | null = null, curr: Reading | null = null;
    if (parts.usage) {
      const rr = args.readings.filter((r) => r.room_id === room.id);
      curr = pickUsageReading(rr, c, parts.kind, usageMonth);
      if (!curr) { rows.push({ ...base, outcome: 'no_reading' }); continue; }
      prev = pickPrevious(rr, curr);
      if (!prev) { rows.push({ ...base, outcome: 'no_previous_reading' }); continue; }
      if (Number(curr.electric) < Number(prev.electric)) { rows.push({ ...base, outcome: 'meter_backwards' }); continue; }
    }
    rows.push({
      ...base,
      outcome: 'created',
      lines: computeBill({
        kind: parts.kind,
        rentMonth: parts.rent ? args.month : null,
        usageMonth: parts.usage ? usageMonth : null,
        rent: parts.rent ? Number(room.default_rent) : 0,
        commonFee: parts.rent ? args.commonFee : 0,
        waterPrev: 0, waterCurr: 0, // water meter not used
        waterPeople: parts.usage ? Number(room.occupants) : 0,
        waterPerPerson: parts.usage ? Number(room.water_per_person) : 0,
        elecPrev: prev ? Number(prev.electric) : 0, elecCurr: curr ? Number(curr.electric) : 0,
        elecRate: parts.usage ? args.electricRate : 0,
      }),
    });
  }
  return rows;
}
