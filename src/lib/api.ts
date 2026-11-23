/* All database access in one place. Every function throws on error so pages can show
 * friendlyError(e). Multi-step actions (move-in, move-out, bill generation) are single
 * database functions, so they either fully happen or not at all. */
import { sb } from './supabase';
import type { Tables, Views } from './database.types';
import { addMonths, byRoomNumber, monthEnd } from './format';
import type { ContractLite, Reading } from './billing';

export type Room = Tables<'rooms'>;
export type Tenant = Tables<'tenants'>;
export type Contract = Tables<'contracts'>;
export type Settings = Tables<'settings'>;
export type Profile = Tables<'profiles'>;
export type BillExtra = Tables<'bill_extras'>;
export type Payment = Tables<'payments'>;
export type BillSummary = Views<'bill_summary'>;
export type ContractWithTenant = Contract & { tenants: Tenant | null };
export type RoomWithCurrent = Room & { current: ContractWithTenant | null };

function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

/** For .single() and RPCs that always return a value: after the error check, data is present. */
function mustOne<T>(res: { data: T; error: unknown }): NonNullable<T> {
  const d = must(res);
  if (d === null || d === undefined) throw new Error('No data returned');
  return d as NonNullable<T>;
}

/* ------------------------------------------------------------------ settings */
export async function getSettings(): Promise<Settings> {
  return mustOne(await sb.from('settings').select('*').eq('id', 1).single());
}

export async function updateSettings(patch: Partial<Pick<Settings, 'dorm_name' | 'water_price_old' | 'water_price_new' | 'electric_rate' | 'due_day'>>) {
  const rows = must(await sb.from('settings').update(patch).eq('id', 1).select('id'));
  if (!rows || rows.length === 0) throw { code: '42501', message: 'permission denied' };
}

/* ------------------------------------------------------------------ rooms & tenants */
export async function listRooms(): Promise<RoomWithCurrent[]> {
  const rows = must(await sb.from('rooms')
    .select('*, contracts(*, tenants(*))')
    .eq('contracts.status', 'active'));
  return (rows ?? [])
    .map(({ contracts, ...room }) => ({ ...room, current: (contracts?.[0] as ContractWithTenant | undefined) ?? null }))
    .sort((a, b) => byRoomNumber(a.number, b.number));
}

export async function getRoom(number: string) {
  const room = must(await sb.from('rooms').select('*').eq('number', number).maybeSingle());
  if (!room) return null;
  const [contracts, readings, settings] = await Promise.all([
    sb.from('contracts').select('*, tenants(*)').eq('room_id', room.id).order('start_date', { ascending: false }),
    sb.from('meter_readings').select('*').eq('room_id', room.id).order('read_on', { ascending: false })
      .order('created_at', { ascending: false }).limit(8),
    getSettings(),
  ]);
  const all = (must(contracts) ?? []) as ContractWithTenant[];
  return {
    room,
    current: all.find((c) => c.status === 'active') ?? null,
    past: all.filter((c) => c.status !== 'active'),
    readings: must(readings) ?? [],
    settings,
  };
}

export async function updateRoom(id: string, patch: Partial<Pick<Room, 'default_rent' | 'notes' | 'status' | 'floor'>>) {
  must(await sb.from('rooms').update(patch).eq('id', id).select('id').single());
}

export async function updateTenant(id: string, patch: Partial<Omit<Tenant, 'id' | 'created_at'>>) {
  must(await sb.from('tenants').update(patch).eq('id', id).select('id').single());
}

/** Rent, water price per person and number of people are remembered on the room (and the
 *  active contract's rent is kept equal), so next month's bills start from these values. */
export async function setRoomPrices(roomId: string, rent: number, waterPerPerson: number, occupants: number) {
  must(await sb.rpc('set_room_prices', { p_room_id: roomId, p_rent: rent, p_water_per_person: waterPerPerson, p_occupants: occupants }));
}

export async function updateContract(id: string, patch: Partial<Pick<Contract, 'end_date' | 'deposit'>>) {
  must(await sb.from('contracts').update(patch).eq('id', id).select('id').single());
}

export interface MoveInInput {
  roomId: string;
  fullName: string; phone: string; idCardRef: string; emergencyName: string; emergencyPhone: string;
  startDate: string; endDate: string | null; monthlyRent: number; deposit: number;
  electric: number;
  waterPerPerson: number; occupants: number;
}

export async function moveIn(x: MoveInInput): Promise<string> {
  return mustOne(await sb.rpc('move_in', {
    p_room_id: x.roomId, p_tenant_id: null,
    p_full_name: x.fullName, p_phone: x.phone, p_id_card_ref: x.idCardRef,
    p_emergency_name: x.emergencyName, p_emergency_phone: x.emergencyPhone,
    p_start_date: x.startDate, p_end_date: x.endDate,
    p_monthly_rent: x.monthlyRent, p_deposit: x.deposit,
    p_water: null, p_electric: x.electric,
    p_water_per_person: x.waterPerPerson, p_occupants: x.occupants,
  }));
}

export interface MoveOutInput {
  contractId: string; date: string; electric: number;
  depositReturned: number; note: string; roomStatus: 'vacant' | 'maintenance' | 'reserved';
}

export async function moveOut(x: MoveOutInput) {
  must(await sb.rpc('move_out', {
    p_contract_id: x.contractId, p_date: x.date, p_water: null, p_electric: x.electric,
    p_deposit_returned: x.depositReturned, p_note: x.note, p_room_status: x.roomStatus,
  }));
}

/* ------------------------------------------------------------------ meters & billing data for one month */
export interface MonthData {
  rooms: Room[];
  contracts: (ContractLite & { tenant_name: string })[];
  readings: Reading[];
  billedRoomIds: Set<string>;
}

/** Everything the Meters and Billing pages need for a month. Readings cover the 12 months
 *  before it, which is enough to find each occupied room's previous reading. */
export async function loadMonth(month: string): Promise<MonthData> {
  const end = monthEnd(month);
  const [rooms, contracts, readings, bills] = await Promise.all([
    sb.from('rooms').select('*'),
    sb.from('contracts').select('id, room_id, start_date, moved_out_on, monthly_rent, created_at, tenants(full_name)')
      .lte('start_date', end).or(`moved_out_on.is.null,moved_out_on.gte.${month}`),
    sb.from('meter_readings').select('id, room_id, kind, month, read_on, water, electric, created_at')
      .gte('month', addMonths(month, -12)).lte('read_on', end),
    sb.from('bills').select('room_id').eq('month', month),
  ]);
  return {
    rooms: (must(rooms) ?? []).sort((a, b) => byRoomNumber(a.number, b.number)),
    contracts: (must(contracts) ?? []).map(({ tenants, ...c }) => ({ ...c, tenant_name: tenants?.full_name ?? '' })),
    readings: must(readings) ?? [],
    billedRoomIds: new Set((must(bills) ?? []).map((b) => b.room_id)),
  };
}

/** Electric meter only (the water meter is not read). Works for any room, vacant ones too. */
export async function saveMonthlyReading(roomId: string, month: string, readOn: string, electric: number) {
  return must(await sb.rpc('save_monthly_reading', {
    p_room_id: roomId, p_month: month, p_read_on: readOn, p_water: null, p_electric: electric,
  }));
}

export async function generateBills(month: string) {
  return must(await sb.rpc('generate_bills', { p_month: month })) ?? [];
}

/* ------------------------------------------------------------------ bills */
export async function listBillsForMonth(month: string): Promise<(BillSummary & { extras: BillExtra[] })[]> {
  const bills = must(await sb.from('bill_summary').select('*').eq('month', month)) ?? [];
  const ids = bills.map((b) => b.id!).filter(Boolean);
  const extras = ids.length ? (must(await sb.from('bill_extras').select('*').in('bill_id', ids).order('created_at')) ?? []) : [];
  return bills
    .map((b) => ({ ...b, extras: extras.filter((x) => x.bill_id === b.id) }))
    .sort((a, b) => byRoomNumber(a.room_number ?? '', b.room_number ?? ''));
}

export async function addExtra(billId: string, label: string, amount: number) {
  must(await sb.from('bill_extras').insert({ bill_id: billId, label: label.trim(), amount }).select('id').single());
}

/** Admin only (RLS). Returns false when nothing was deleted (e.g. staff). */
export async function deleteExtra(id: string): Promise<boolean> {
  const rows = must(await sb.from('bill_extras').delete().eq('id', id).select('id'));
  return (rows?.length ?? 0) > 0;
}

export async function deleteBill(id: string): Promise<boolean> {
  const rows = must(await sb.from('bills').delete().eq('id', id).select('id'));
  return (rows?.length ?? 0) > 0;
}

/* ------------------------------------------------------------------ staff accounts (admin) */
export async function listProfiles(): Promise<Profile[]> {
  return (must(await sb.from('profiles').select('*').order('created_at')) ?? []);
}

export async function setRole(id: string, role: 'admin' | 'staff' | null) {
  must(await sb.from('profiles').update({ role }).eq('id', id).select('id').single());
}
