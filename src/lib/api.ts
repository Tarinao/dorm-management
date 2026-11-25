/* All database access in one place. Every function throws on error so pages can show
 * friendlyError(e). Multi-step actions (move-in, move-out, bill generation) are single
 * database functions, so they either fully happen or not at all. */
import { sb } from './supabase';
import type { Tables, Views } from './database.types';
import { addMonths, byRoomNumber, monthEnd, tenantShort } from './format';
import type { ContractLite, Reading } from './billing';

export type Room = Tables<'rooms'>;
export type Tenant = Tables<'tenants'>;
export type Contract = Tables<'contracts'>;
export type Settings = Tables<'settings'>;
export type Profile = Tables<'profiles'>;
export type BillExtra = Tables<'bill_extras'>;
export type Payment = Tables<'payments'>;
export type BillSummary = Views<'bill_summary'>;
export type LineRequest = Tables<'line_link_requests'>;
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

export type SettingsPatch = Partial<Omit<Settings, 'id' | 'updated_at'>>;

export async function updateSettings(patch: SettingsPatch) {
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
    sb.from('contracts').select('id, room_id, start_date, moved_out_on, monthly_rent, created_at, tenants(full_name, nickname)')
      .lte('start_date', end).or(`moved_out_on.is.null,moved_out_on.gte.${month}`),
    sb.from('meter_readings').select('id, room_id, kind, month, read_on, water, electric, created_at')
      .gte('month', addMonths(month, -12)).lte('read_on', end),
    sb.from('bills').select('room_id').eq('month', month),
  ]);
  return {
    rooms: (must(rooms) ?? []).sort((a, b) => byRoomNumber(a.number, b.number)),
    // tenant_name here is the short name shown as "101 (Nok)" (nickname, else first name).
    contracts: (must(contracts) ?? []).map(({ tenants, ...c }) => ({ ...c, tenant_name: tenantShort(tenants) })),
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
export async function listBillsForMonth(month: string): Promise<(BillSummary & { extras: BillExtra[]; payments: Payment[] })[]> {
  const bills = must(await sb.from('bill_summary').select('*').eq('month', month)) ?? [];
  const ids = bills.map((b) => b.id!).filter(Boolean);
  const [extras, payments] = await Promise.all([
    ids.length ? sb.from('bill_extras').select('*').in('bill_id', ids).order('created_at').then(must) : Promise.resolve([]),
    listPayments(ids),
  ]);
  return bills
    .map((b) => ({ ...b, extras: (extras ?? []).filter((x) => x.bill_id === b.id), payments: payments.filter((p) => p.bill_id === b.id) }))
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

/* ------------------------------------------------------------------ payments */
export type BillRow = BillSummary & { tenant_name: string; tenant_short: string };

/** Tenant for each bill (bills keep the contract they were made for): full name, and the
 *  short name used in "101 (Nok)". */
async function withTenants<T extends { contract_id: string | null }>(bills: T[]): Promise<(T & { tenant_name: string; tenant_short: string })[]> {
  const ids = [...new Set(bills.map((b) => b.contract_id).filter((x): x is string => !!x))];
  const rows = ids.length ? (must(await sb.from('contracts').select('id, tenants(full_name, nickname)').in('id', ids)) ?? []) : [];
  const byId = new Map(rows.map((r) => [r.id, r.tenants]));
  return bills.map((b) => {
    const tn = b.contract_id ? byId.get(b.contract_id) : null;
    return { ...b, tenant_name: tn?.full_name ?? '', tenant_short: tenantShort(tn) };
  });
}

export type BillFilter = 'overdue' | 'open' | 'paid' | 'all';

/** Bills across all months, newest first. 'open' = unpaid or partly paid. */
export async function listBills(filter: BillFilter, roomId?: string): Promise<BillRow[]> {
  let q = sb.from('bill_summary').select('*').order('month', { ascending: false });
  if (roomId) q = q.eq('room_id', roomId);
  if (filter === 'overdue') q = q.eq('is_overdue', true);
  if (filter === 'open') q = q.neq('status', 'paid');
  if (filter === 'paid') q = q.eq('status', 'paid');
  const bills = (must(await q.limit(500)) ?? []).sort((a, b) =>
    (b.month ?? '').localeCompare(a.month ?? '') || byRoomNumber(a.room_number ?? '', b.room_number ?? ''));
  return withTenants(bills);
}

/** Payments for some bills, oldest first. */
export async function listPayments(billIds: string[]): Promise<Payment[]> {
  if (billIds.length === 0) return [];
  const out: Payment[] = [];
  for (let i = 0; i < billIds.length; i += 150) {   // keep the URL short
    out.push(...(must(await sb.from('payments').select('*').in('bill_id', billIds.slice(i, i + 150))
      .order('paid_on').order('created_at')) ?? []));
  }
  return out;
}

export interface PaymentInput { billId: string; amount: number; paidOn: string; method: 'cash' | 'transfer'; note: string }

/** Returns the new payment (with its receipt number). The database refuses more than the balance. */
export async function recordPayment(x: PaymentInput): Promise<Payment> {
  return mustOne(await sb.from('payments')
    .insert({ bill_id: x.billId, amount: x.amount, paid_on: x.paidOn, method: x.method, note: x.note.trim() })
    .select('*').single());
}

/** Admin only (RLS). Returns false when nothing was deleted. */
export async function deletePayment(id: string): Promise<boolean> {
  const rows = must(await sb.from('payments').delete().eq('id', id).select('id'));
  return (rows?.length ?? 0) > 0;
}

/** Everything a printed receipt shows. */
export async function getReceipt(paymentId: string) {
  const payment = must(await sb.from('payments').select('*').eq('id', paymentId).maybeSingle());
  if (!payment) return null;
  const [bill, extras, all, settings] = await Promise.all([
    sb.from('bill_summary').select('*').eq('id', payment.bill_id).single(),
    sb.from('bill_extras').select('*').eq('bill_id', payment.bill_id).order('created_at'),
    sb.from('payments').select('*').eq('bill_id', payment.bill_id).order('paid_on').order('created_at'),
    getSettings(),
  ]);
  const [b] = await withTenants([mustOne(bill)]);
  const payments = must(all) ?? [];
  // Balance right after this payment: everything paid up to and including it.
  const upto = payments.slice(0, payments.findIndex((p) => p.id === payment.id) + 1);
  const paidSoFar = upto.reduce((s, p) => s + Number(p.amount), 0);
  return {
    payment, bill: b, extras: must(extras) ?? [], settings,
    paidBefore: paidSoFar - Number(payment.amount),
    balanceAfter: Math.round((Number(b.total) - paidSoFar) * 100) / 100,
  };
}

/* ------------------------------------------------------------------ dashboard */
export async function loadDashboard() {
  const [rooms, bills] = await Promise.all([
    sb.from('rooms').select('id, number, status'),
    sb.from('bill_summary').select('id, room_id, room_number, contract_id, month, total, paid, balance, status, is_overdue, due_date'),
  ]);
  const withNames = await withTenants(must(bills) ?? []);
  // The dashboard shows "101 (Nok)", so it gets the short name.
  return { rooms: must(rooms) ?? [], bills: withNames.map((b) => ({ ...b, tenant_name: b.tenant_short })) };
}

/* ------------------------------------------------------------------ LINE */
export async function listLineRequests(): Promise<LineRequest[]> {
  return must(await sb.from('line_link_requests').select('*').eq('status', 'pending').order('created_at')) ?? [];
}

export interface LineDecision {
  room_number: string; label?: string; line_display_name?: string; previous_room?: string | null;
  pushed: boolean; push_error?: string;
}

/** Approve / reject run in the line-link Edge Function (it holds the LINE token and sends the
 *  tenant a message); the database part runs as the logged-in user, under RLS. */
export async function decideLineRequest(action: 'approve' | 'reject', requestId: string): Promise<LineDecision> {
  const { data, error } = await sb.functions.invoke<LineDecision>('line-link', { body: { action, request_id: requestId } });
  if (error) {
    // The function answers { error: 'ROOM_HAS_NO_TENANT' | ... }; turn it into a normal error message.
    let code = '';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? ''; } catch { /* not JSON */ }
    throw { message: code || error.message };
  }
  return data!;
}

/** Remove the LINE link from a tenant (e.g. linked by mistake). */
export async function unlinkLine(tenantId: string) {
  await updateTenant(tenantId, { line_user_id: null, line_display_name: '', line_linked_at: null });
}

/** Move-in creates the tenant inside move_in(); the nickname is saved right after. */
export async function setNicknameForContract(contractId: string, nickname: string) {
  const c = mustOne(await sb.from('contracts').select('tenant_id').eq('id', contractId).single());
  await updateTenant(c.tenant_id, { nickname });
}
