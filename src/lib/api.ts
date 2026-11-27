/* All database access in one place. Every function throws on error so pages can show
 * friendlyError(e). Multi-step actions (move-in, move-out, bill generation) are single
 * database functions, so they either fully happen or not at all. */
import { sb } from './supabase';
import type { Tables, Views } from './database.types';
import { addMonths, byRoomNumber, monthEnd, tenantShort, todayISO } from './format';
import type { ContractLite, Reading } from './billing';
import type { InvoiceData, InvoiceDorm } from './invoice';

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
export type Reservation = Tables<'reservations'>;
export type ReservationWithRoom = Reservation & { rooms: { number: string } | null };
export type Ticket = Tables<'maintenance_tickets'>;
export type TicketWithRoom = Ticket & { rooms: { number: string } | null };
export type LineUser = Tables<'line_users'>;
export type Viewing = Tables<'viewings'>;
export type ViewingWithRoom = Viewing & { rooms: { number: string } | null };
export type LineInfo = Tables<'line_info'>;

/* ---------------------------------------------------------------- LINE faces */
export type LineFace = { display_name: string; picture_url: string };
let facesCache: { at: number; p: Promise<Map<string, LineFace>> } | null = null;

/** LINE name + profile picture of everyone who has talked to the bot, keyed by line_user_id.
 *  One small query shared by every avatar on the page, kept for a minute. */
export function lineFaces(): Promise<Map<string, LineFace>> {
  if (!facesCache || Date.now() - facesCache.at > 60_000) {
    const p = Promise.resolve(sb.from('line_users').select('line_user_id, display_name, picture_url')).then((r) => {
      if (r.error) throw r.error;
      return new Map((r.data ?? []).map((u) => [u.line_user_id, { display_name: u.display_name, picture_url: u.picture_url }]));
    });
    p.catch(() => { if (facesCache?.p === p) facesCache = null; });  // retry next time
    facesCache = { at: Date.now(), p };
  }
  return facesCache.p;
}
export type RoomWithCurrent = Room & {
  current: ContractWithTenant | null;
  reservation: Reservation | null;          // the pending / confirmed booking on this room, if any
  openTickets: number;                      // maintenance tickets still open
};

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
  const [rows, reservations, tickets] = await Promise.all([
    sb.from('rooms').select('*, contracts(*, tenants(*))').eq('contracts.status', 'active').then(must),
    sb.from('reservations').select('*').in('status', ['pending', 'confirmed']).not('room_id', 'is', null).then(must),
    sb.from('maintenance_tickets').select('room_id').in('status', ['open', 'in_progress']).then(must),
  ]);
  return (rows ?? [])
    .map(({ contracts, ...room }) => ({
      ...room,
      current: (contracts?.[0] as ContractWithTenant | undefined) ?? null,
      reservation: (reservations ?? []).find((r) => r.room_id === room.id) ?? null,
      openTickets: (tickets ?? []).filter((t) => t.room_id === room.id).length,
    }))
    .sort((a, b) => byRoomNumber(a.number, b.number));
}

export async function getRoom(number: string) {
  const room = must(await sb.from('rooms').select('*').eq('number', number).maybeSingle());
  if (!room) return null;
  const [contracts, readings, settings, reservations, tickets] = await Promise.all([
    sb.from('contracts').select('*, tenants(*)').eq('room_id', room.id).order('start_date', { ascending: false }),
    sb.from('meter_readings').select('*').eq('room_id', room.id).order('read_on', { ascending: false })
      .order('created_at', { ascending: false }).limit(8),
    getSettings(),
    sb.from('reservations').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(20),
    sb.from('maintenance_tickets').select('*').eq('room_id', room.id).order('opened_at', { ascending: false }).limit(50),
  ]);
  const all = (must(contracts) ?? []) as ContractWithTenant[];
  const res = must(reservations) ?? [];
  return {
    room,
    current: all.find((c) => c.status === 'active') ?? null,
    past: all.filter((c) => c.status !== 'active'),
    readings: must(readings) ?? [],
    settings,
    reservation: res.find((r) => r.status === 'pending' || r.status === 'confirmed') ?? null,
    pastReservations: res.filter((r) => r.status !== 'pending' && r.status !== 'confirmed'),
    tickets: must(tickets) ?? [],
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
  reservationId?: string | null;   // "Convert to move-in": marks the booking moved in, credits its fee
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
    ...(x.reservationId ? { p_reservation_id: x.reservationId } : {}),
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
  billedContractIds: Set<string>;   // contracts that already have a bill for this (bill) month
  usageBilledRoomIds: Set<string>;  // rooms whose usage of this month is already on a bill (Meters page)
}

/** Everything the Meters and Billing pages need for a month. Readings cover the 12 months
 *  before it, which is enough to find each occupied room's previous reading. Contracts include
 *  those that left during the month before (their final bill is made this month). */
export async function loadMonth(month: string): Promise<MonthData> {
  const end = monthEnd(month);
  const [rooms, contracts, readings, bills] = await Promise.all([
    sb.from('rooms').select('*'),
    sb.from('contracts').select('id, room_id, start_date, moved_out_on, monthly_rent, created_at, tenants(full_name, nickname)')
      .lte('start_date', end).or(`moved_out_on.is.null,moved_out_on.gte.${addMonths(month, -1)}`),
    sb.from('meter_readings').select('id, room_id, kind, month, read_on, water, electric, created_at')
      .gte('month', addMonths(month, -12)).lte('read_on', end),
    sb.from('bills').select('room_id, contract_id, month, usage_month').or(`month.eq.${month},usage_month.eq.${month}`),
  ]);
  const billRows = must(bills) ?? [];
  return {
    rooms: (must(rooms) ?? []).sort((a, b) => byRoomNumber(a.number, b.number)),
    // tenant_name here is the short name shown as "101 (Nok)" (nickname, else first name).
    contracts: (must(contracts) ?? []).map(({ tenants, ...c }) => ({ ...c, tenant_name: tenantShort(tenants) })),
    readings: must(readings) ?? [],
    billedContractIds: new Set(billRows.filter((b) => b.month === month && b.contract_id).map((b) => b.contract_id!)),
    usageBilledRoomIds: new Set(billRows.filter((b) => b.usage_month === month).map((b) => b.room_id)),
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

/** The LINE account linked to the tenant of a contract (null = not linked). move_in() links the
 *  reservation's LINE account unless it belongs to a current tenant (migration 20261127071400). */
export async function contractTenantLine(contractId: string): Promise<string | null> {
  const c = mustOne(await sb.from('contracts').select('tenants(line_user_id)').eq('id', contractId).single()) as unknown as
    { tenants: { line_user_id: string | null } | null };
  return c.tenants?.line_user_id ?? null;
}

/** Move-in creates the tenant inside move_in(); the nickname is saved right after. */
/** Tenant details move_in() does not take (nickname, address), saved right after it. */
export async function updateTenantForContract(contractId: string, patch: Partial<Pick<Tenant, 'nickname' | 'address'>>) {
  const c = mustOne(await sb.from('contracts').select('tenant_id').eq('id', contractId).single());
  await updateTenant(c.tenant_id, patch);
}

/* ------------------------------------------------------------------ bills on LINE (0010) */
export type RunSummary = import('../../supabase/functions/_shared/core').RunSummary;
export type SendRun = Tables<'line_send_runs'>;

/** Error code from an Edge Function's { error: 'CODE' } answer, as a normal error. */
/* ---------------------------------------------------------------- LINE message on confirm */
export type NotifyResult = { pushed: boolean; reason?: 'NO_LINE' | 'NOT_CONFIRMED' | 'PUSH_FAILED' };

/** Tells the guest on LINE that staff confirmed their viewing / reservation (line-notify).
 *  Never throws: the confirmation itself is already saved, so a failed message is only reported. */
export async function notifyConfirmed(kind: 'viewing' | 'reservation', id: string): Promise<NotifyResult> {
  try {
    const { data, error } = await sb.functions.invoke<NotifyResult>('line-notify', { body: { kind, id } });
    return error || !data ? { pushed: false, reason: 'PUSH_FAILED' } : data;
  } catch {
    return { pushed: false, reason: 'PUSH_FAILED' };
  }
}

async function functionError(error: unknown): Promise<never> {
  let code = '';
  try { code = (await (error as { context?: Response }).context?.json())?.error ?? ''; } catch { /* not JSON */ }
  throw { message: code || (error as Error).message };
}

/** "Generate & send via LINE": makes the month's bills (like Generate) and sends every bill not
 *  sent yet to tenants linked to LINE. Safe to press twice: a bill is never sent twice. */
export async function sendBillsOnLine(month: string): Promise<RunSummary> {
  const { data, error } = await sb.functions.invoke<{ summary: RunSummary }>('monthly-bills', { body: { mode: 'send', month } });
  if (error) return functionError(error);
  return data!.summary;
}

export async function lastSendRun(): Promise<SendRun | null> {
  return must(await sb.from('line_send_runs').select('*').neq('kind', 'reminders').order('ran_at', { ascending: false }).limit(1))?.[0] ?? null;
}

/** LINE accounts the owner can choose for the monthly summary: anyone who has messaged the OA. */
export async function knownLineAccounts(): Promise<{ line_user_id: string; name: string }[]> {
  const [rows, users] = await Promise.all([
    sb.from('line_link_requests').select('line_user_id, line_display_name, created_at').order('created_at', { ascending: false }).then(must),
    // Everyone who has talked to the bot (line_users, migration 0013).
    sb.from('line_users').select('line_user_id, display_name').order('last_seen', { ascending: false }).then((r) => r.data ?? []),
  ]);
  const seen = new Map<string, string>();
  for (const r of rows ?? []) if (!seen.has(r.line_user_id)) seen.set(r.line_user_id, r.line_display_name || r.line_user_id.slice(0, 8));
  for (const u of users) if (!seen.has(u.line_user_id)) seen.set(u.line_user_id, u.display_name || u.line_user_id.slice(0, 8));
  return [...seen].map(([line_user_id, name]) => ({ line_user_id, name }));
}

/* ------------------------------------------------------------------ payment slips (0010) */
export type Slip = Tables<'payment_slips'> & {
  url: string | null;                       // signed link to the photo (1 hour)
  bill: BillSummary | null;
  tenant: { full_name: string; nickname: string } | null;
  original: { received_at: string; status: string } | null;   // for duplicates: the first slip
};

/** Slips sent in the LINE chat that staff have not checked yet, newest first. */
export async function listPendingSlips(): Promise<Slip[]> {
  const slips = must(await sb.from('payment_slips').select('*').eq('status', 'pending').order('received_at', { ascending: false })) ?? [];
  if (slips.length === 0) return [];
  const billIds = [...new Set(slips.map((s) => s.bill_id).filter((x): x is string => !!x))];
  const tenantIds = [...new Set(slips.map((s) => s.tenant_id).filter((x): x is string => !!x))];
  const origIds = [...new Set(slips.map((s) => s.duplicate_of).filter((x): x is string => !!x))];
  const [bills, tenants, originals, urls] = await Promise.all([
    billIds.length ? sb.from('bill_summary').select('*').in('id', billIds).then(must) : Promise.resolve([]),
    tenantIds.length ? sb.from('tenants').select('id, full_name, nickname').in('id', tenantIds).then(must) : Promise.resolve([]),
    origIds.length ? sb.from('payment_slips').select('id, received_at, status').in('id', origIds).then(must) : Promise.resolve([]),
    sb.storage.from('slips').createSignedUrls(slips.map((s) => s.storage_path), 3600),
  ]);
  const urlOf = new Map((urls.data ?? []).map((u) => [u.path, u.signedUrl]));
  return slips.map((s) => ({
    ...s,
    url: urlOf.get(s.storage_path) ?? null,
    bill: (bills ?? []).find((b) => b.id === s.bill_id) ?? null,
    tenant: (tenants ?? []).find((t) => t.id === s.tenant_id) ?? null,
    original: (originals ?? []).find((o) => o.id === s.duplicate_of) ?? null,
  }));
}

/** Staff checked the slip with the bank: records the payment (bank transfer) and closes the slip. */
export async function confirmSlip(slipId: string, amount: number, paidOn: string, note: string): Promise<string> {
  return mustOne(await sb.rpc('confirm_slip', { p_slip_id: slipId, p_amount: amount, p_paid_on: paidOn, p_note: note }));
}

export async function rejectSlip(slipId: string, userId: string | undefined) {
  must(await sb.from('payment_slips')
    .update({ status: 'rejected', checked_at: new Date().toISOString(), checked_by: userId ?? null })
    .eq('id', slipId).eq('status', 'pending').select('id'));
}

/* ------------------------------------------------------------------ reservations (0012) */
export type ReservationFilter = 'active' | 'pending' | 'confirmed' | 'closed' | 'all';

/** Bookings, soonest move-in first. 'active' = pending + confirmed. */
export async function listReservations(filter: ReservationFilter): Promise<ReservationWithRoom[]> {
  let q = sb.from('reservations').select('*, rooms(number)');
  if (filter === 'active') q = q.in('status', ['pending', 'confirmed']);
  else if (filter === 'closed') q = q.in('status', ['cancelled', 'expired', 'moved_in']);
  else if (filter !== 'all') q = q.eq('status', filter);
  const rows = must(await q.order('desired_move_in', { ascending: filter !== 'closed' }).limit(500)) ?? [];
  return rows as ReservationWithRoom[];
}

export async function getReservation(id: string): Promise<ReservationWithRoom | null> {
  return (must(await sb.from('reservations').select('*, rooms(number)').eq('id', id).maybeSingle()) as ReservationWithRoom | null);
}

export type ReservationInput = Pick<Reservation,
  'room_id' | 'guest_name' | 'phone' | 'desired_move_in' | 'expires_on' | 'booking_fee' | 'booking_fee_paid_on' | 'booking_fee_method' | 'note'>
  & { line_user_id?: string | null };   // carried over when the reservation is made from a LINE viewing

/** New booking (pending, or confirmed straight away) or an edit. The database checks the room
 *  rules and the one-booking-per-room rule. */
export async function saveReservation(id: string | null, x: ReservationInput, confirmNow = false): Promise<Reservation> {
  const row = { ...x, guest_name: x.guest_name.trim(), phone: x.phone.trim(), note: x.note.trim() };
  if (id) return mustOne(await sb.from('reservations').update(row).eq('id', id).select('*').single());
  return mustOne(await sb.from('reservations').insert({ ...row, status: confirmNow ? 'confirmed' : 'pending' }).select('*').single());
}

export async function setReservationStatus(id: string, status: 'confirmed' | 'cancelled') {
  must(await sb.from('reservations').update({ status }).eq('id', id).select('id').single());
}

/** Admin only (RLS). Returns false when nothing was deleted. */
export async function deleteReservation(id: string): Promise<boolean> {
  const rows = must(await sb.from('reservations').delete().eq('id', id).select('id'));
  return (rows?.length ?? 0) > 0;
}

/** What the reservation rules need (see lib/reservations.ts): every room with its status, active
 *  contracts (move-out date), active bookings and open tickets. */
export async function reservationRulesData() {
  const [rooms, contracts, reservations, tickets] = await Promise.all([
    sb.from('rooms').select('id, number, status, default_rent').then(must),
    sb.from('contracts').select('room_id, status, end_date').eq('status', 'active').then(must),
    sb.from('reservations').select('id, room_id, status').in('status', ['pending', 'confirmed']).then(must),
    sb.from('maintenance_tickets').select('room_id, status, block_room').in('status', ['open', 'in_progress']).then(must),
  ]);
  return {
    rooms: (rooms ?? []).sort((a, b) => byRoomNumber(a.number, b.number)),
    contracts: contracts ?? [], reservations: reservations ?? [], tickets: tickets ?? [],
  };
}

/** A printed booking-fee receipt. */
export async function getBookingReceipt(id: string) {
  const [r, settings] = await Promise.all([getReservation(id), getSettings()]);
  return r && r.booking_receipt_no ? { reservation: r, settings } : null;
}

/* ------------------------------------------------------------------ maintenance (0012) */
export type TicketFilter = 'open' | 'closed' | 'all';

export async function listTickets(filter: TicketFilter, roomId?: string): Promise<TicketWithRoom[]> {
  let q = sb.from('maintenance_tickets').select('*, rooms(number)');
  if (roomId) q = q.eq('room_id', roomId);
  if (filter === 'open') q = q.in('status', ['open', 'in_progress']);
  if (filter === 'closed') q = q.in('status', ['done', 'cancelled']);
  return (must(await q.order('opened_at', { ascending: false }).limit(500)) ?? []) as TicketWithRoom[];
}

export type TicketInput = Pick<Ticket,
  'room_id' | 'title' | 'description' | 'category' | 'priority' | 'status' | 'reported_by' | 'block_room' | 'cost' | 'assigned_to'>;

export async function saveTicket(id: string | null, x: TicketInput): Promise<Ticket> {
  const row = { ...x, title: x.title.trim(), description: x.description.trim(), assigned_to: x.assigned_to.trim() };
  if (id) {
    const { room_id: _fixed, ...patch } = row;   // a ticket stays on its room
    return mustOne(await sb.from('maintenance_tickets').update(patch).eq('id', id).select('*').single());
  }
  return mustOne(await sb.from('maintenance_tickets').insert(row).select('*').single());
}

export async function setTicketStatus(id: string, status: 'open' | 'in_progress' | 'done' | 'cancelled') {
  must(await sb.from('maintenance_tickets').update({ status }).eq('id', id).select('id').single());
}

/** Admin only (RLS). */
export async function deleteTicket(id: string): Promise<boolean> {
  const rows = must(await sb.from('maintenance_tickets').delete().eq('id', id).select('id'));
  return (rows?.length ?? 0) > 0;
}

/** Upload a photo into the private "maintenance" bucket and add it to the ticket. */
export async function addTicketPhoto(ticket: Ticket, file: File): Promise<Ticket> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${ticket.id}/${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from('maintenance').upload(path, file, { contentType: file.type || 'image/jpeg' });
  if (up.error) throw up.error;
  return mustOne(await sb.from('maintenance_tickets').update({ photos: [...ticket.photos, path] }).eq('id', ticket.id).select('*').single());
}

/** Remove a photo from the ticket. Only an admin may delete the file itself (RLS); for staff the
 *  file simply stays in the private bucket, no longer shown. */
export async function removeTicketPhoto(ticket: Ticket, path: string): Promise<Ticket> {
  const t = mustOne(await sb.from('maintenance_tickets').update({ photos: ticket.photos.filter((p) => p !== path) }).eq('id', ticket.id).select('*').single());
  await sb.storage.from('maintenance').remove([path]);
  return t;
}

/** Signed links (1 hour) for ticket photos. */
export async function ticketPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data } = await sb.storage.from('maintenance').createSignedUrls(paths, 3600);
  const out = new Map<string, string>();
  for (const u of data ?? []) if (u.path && u.signedUrl) out.set(u.path, u.signedUrl);
  return out;
}

/* ------------------------------------------------------------------ LINE chats & dorm info (0013) */
export type WantsToTalk = LineUser & { room: string | null; tenant: { full_name: string; nickname: string } | null };

/** People who tapped "Contact staff" and are waiting for an answer, oldest first. */
export async function listWantsToTalk(): Promise<WantsToTalk[]> {
  const users = must(await sb.from('line_users').select('*').not('wants_talk_at', 'is', null).order('wants_talk_at')) ?? [];
  if (users.length === 0) return [];
  const tenants = must(await sb.from('tenants').select('full_name, nickname, line_user_id, contracts(status, rooms(number))')
    .in('line_user_id', users.map((u) => u.line_user_id))) ?? [];
  return users.map((u) => {
    const tn = tenants.find((x) => x.line_user_id === u.line_user_id);
    const contracts = (tn?.contracts ?? []) as unknown as { status: string; rooms: { number: string } | null }[];
    const active = contracts.find((c) => c.status === 'active');
    return { ...u, room: active?.rooms?.number ?? null, tenant: tn ? { full_name: tn.full_name, nickname: tn.nickname } : null };
  });
}

/** "Done": the chat is handled. botBack = the bot may answer this person again right away. */
export async function lineChatDone(lineUserId: string, botBack: boolean) {
  must(await sb.rpc('line_chat_done', { p_line_user_id: lineUserId, p_bot_back: botBack }));
}

export async function getLineInfo(): Promise<LineInfo[]> {
  return must(await sb.from('line_info').select('*')) ?? [];
}

/** Admin only (RLS). */
export async function saveLineInfo(rows: { key: string; text_th: string; text_en: string }[]) {
  for (const r of rows) {
    const done = must(await sb.from('line_info').update({ text_th: r.text_th.trim(), text_en: r.text_en.trim() }).eq('key', r.key).select('key'));
    if (!done || done.length === 0) throw { code: '42501', message: 'permission denied' };
  }
}

/* ------------------------------------------------------------------ dashboard extras */
export async function loadDashboardExtras() {
  const [tickets, reservations, viewings] = await Promise.all([
    sb.from('maintenance_tickets').select('id, priority').in('status', ['open', 'in_progress']).then(must),
    sb.from('reservations').select('id, status').in('status', ['pending', 'confirmed']).then(must),
    sb.from('viewings').select('id, status').in('status', ['requested', 'confirmed']).gte('visit_date', todayISO()).then(must),
  ]);
  return {
    requestedViewings: (viewings ?? []).filter((x) => x.status === 'requested').length,
    upcomingViewings: viewings?.length ?? 0,
    openTickets: tickets?.length ?? 0,
    urgentTickets: (tickets ?? []).filter((x) => x.priority === 'urgent').length,
    pendingReservations: (reservations ?? []).filter((x) => x.status === 'pending').length,
    confirmedReservations: (reservations ?? []).filter((x) => x.status === 'confirmed').length,
  };
}

/* ------------------------------------------------------------------ viewings (0014) */
/* A viewing = someone comes to SEE a room. Nothing is held: it is not a reservation. */
export type ViewingFilter = 'open' | 'requested' | 'closed' | 'all';
export type ViewingStatus = 'requested' | 'confirmed' | 'viewed' | 'no_show' | 'cancelled';
export const TIMES_OF_DAY = ['morning', 'afternoon', 'evening', 'any'] as const;

/** 'open' = requested + confirmed, soonest first; 'closed' = viewed, no-show, cancelled, latest first. */
export async function listViewings(filter: ViewingFilter): Promise<ViewingWithRoom[]> {
  let q = sb.from('viewings').select('*, rooms(number)');
  if (filter === 'open') q = q.in('status', ['requested', 'confirmed']);
  else if (filter === 'closed') q = q.in('status', ['viewed', 'no_show', 'cancelled']);
  else if (filter === 'requested') q = q.eq('status', 'requested');
  const rows = must(await q.order('visit_date', { ascending: filter !== 'closed' }).order('visit_time', { ascending: true, nullsFirst: false }).limit(500)) ?? [];
  return rows as ViewingWithRoom[];
}

export type ViewingInput = Pick<Viewing, 'guest_name' | 'phone' | 'visit_date' | 'time_of_day' | 'visit_time' | 'room_id' | 'note'>;

export async function saveViewing(id: string | null, x: ViewingInput): Promise<Viewing> {
  const row = { ...x, guest_name: x.guest_name.trim(), phone: x.phone.trim(), note: x.note.trim() };
  if (id) return mustOne(await sb.from('viewings').update(row).eq('id', id).select('*').single());
  return mustOne(await sb.from('viewings').insert({ ...row, status: 'requested' }).select('*').single());
}

export async function setViewingStatus(id: string, status: ViewingStatus) {
  must(await sb.from('viewings').update({ status }).eq('id', id).select('id').single());
}

/** After "Reserve a room" on a viewing: remember which reservation came from it. */
export async function linkViewingReservation(id: string, reservationId: string) {
  must(await sb.from('viewings').update({ reservation_id: reservationId, status: 'viewed' }).eq('id', id).select('id').single());
}

/** Admin only (RLS). Returns false when nothing was deleted. */
export async function deleteViewing(id: string): Promise<boolean> {
  const rows = must(await sb.from('viewings').delete().eq('id', id).select('id'));
  return (rows?.length ?? 0) > 0;
}

/* ------------------------------------------------------------------ invoices (ใบแจ้งหนี้) */
/** Everything the printed invoice of one bill shows (null when the bill does not exist). */
export async function getInvoice(billId: string): Promise<InvoiceData | null> {
  const bill = must(await sb.from('bill_summary').select('*').eq('id', billId).maybeSingle());
  if (!bill) return null;
  const [extras, contract, settings] = await Promise.all([
    sb.from('bill_extras').select('label, amount').eq('bill_id', billId).order('created_at').then(must),
    bill.contract_id
      ? sb.from('contracts').select('tenants(full_name, address, phone)').eq('id', bill.contract_id).maybeSingle().then(must)
      : Promise.resolve(null),
    getSettings(),
  ]);
  const tn = (contract as { tenants: { full_name: string; address: string; phone: string } | null } | null)?.tenants ?? null;
  return {
    bill: {
      id: bill.id!, invoice_no: bill.invoice_no ?? '', month: bill.month!, rent_month: bill.rent_month, usage_month: bill.usage_month,
      room_number: bill.room_number ?? '', rent: Number(bill.rent), common_fee: Number(bill.common_fee),
      water_people: Number(bill.water_people), water_per_person: Number(bill.water_per_person), water_amount: Number(bill.water_amount),
      elec_prev: Number(bill.elec_prev), elec_curr: Number(bill.elec_curr), elec_units: Number(bill.elec_units), elec_amount: Number(bill.elec_amount),
      total: Number(bill.total), due_date: bill.due_date!, created_at: bill.created_at!, note: bill.note ?? '', issued_by_name: bill.issued_by_name ?? '',
    },
    extras: (extras ?? []).map((x) => ({ label: x.label, amount: Number(x.amount) })),
    tenant: tn,
    dorm: dormForInvoice(settings, await logoUrl(settings.logo_path)),
  };
}

export function dormForInvoice(s: Settings, logo: string | null): InvoiceDorm {
  return {
    name: s.dorm_name, name_en: s.dorm_name_en, address: s.address, tax_id: s.tax_id, phone: s.office_phone, email: s.email,
    line_oa_id: s.line_oa_id, invoice_note: s.invoice_note, biller_name: s.biller_name, bank_name: s.bank_name, bank_branch: s.bank_branch,
    bank_account_name: s.bank_account_name, bank_account_number: s.bank_account_number, promptpay_id: s.promptpay_id, logo,
  };
}

/** The invoice behind a LINE "View invoice" link (no login). Null for a wrong or expired link. */
export async function getPublicInvoice(token: string): Promise<InvoiceData | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data, error } = await sb.functions.invoke<InvoiceData>('invoice', { body: { token } });
  if (error) {
    const status = (error as { context?: Response }).context?.status;
    if (status === 404 || status === 400) return null;
    throw error;
  }
  return data ?? null;
}

/* ------------------------------------------------------------------ logo (private "branding" bucket) */
/** A short-lived link to the logo, or null when there is none. */
export async function logoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await sb.storage.from('branding').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** Admin only (Storage policies + settings RLS). Replaces the logo; the old file is removed. */
export async function uploadLogo(file: File, oldPath: string | null) {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `logo/logo-${Date.now()}.${ext}`;
  const up = await sb.storage.from('branding').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  try {
    await updateSettings({ logo_path: path });
  } catch (e) {
    await sb.storage.from('branding').remove([path]);
    throw e;
  }
  if (oldPath && oldPath !== path) await sb.storage.from('branding').remove([oldPath]);
}

export async function removeLogo(path: string) {
  await updateSettings({ logo_path: null });
  await sb.storage.from('branding').remove([path]);
}

/* ------------------------------------------------------------------ staff names (shown as "Issued by") */
export async function setProfileName(id: string, fullName: string) {
  must(await sb.from('profiles').update({ full_name: fullName.trim() }).eq('id', id).select('id').single());
}
