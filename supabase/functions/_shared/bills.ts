/* Bills as the LINE functions need them: amounts from bill_summary, extras, and the tenant of the
 * bill's contract (with their LINE account). Runs with the service-role client. */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import { PAY_BUTTON, payOrder, payPostback, type BillForMessage, type PayDetails } from './core.ts';

export type BillRow = {
  id: string; room_id: string; room_number: string; contract_id: string | null; month: string; due_date: string;
  rent: number; water_people: number; water_per_person: number; water_amount: number;
  elec_prev: number; elec_curr: number; elec_units: number; elec_rate: number; elec_amount: number;
  total: number; paid: number; balance: number;
  line_sent_at: string | null; line_reminded_at: string | null; pay_method_chosen: string | null;
};
export type Tenant = { id: string; full_name: string; nickname: string; line_user_id: string | null };
export type LoadedBill = { bill: BillRow; extras: { label: string; amount: number }[]; tenant: Tenant | null; lastChoice: string | null };

const BILL_COLS = 'id, room_id, room_number, contract_id, month, due_date, rent, water_people, water_per_person, water_amount, ' +
  'elec_prev, elec_curr, elec_units, elec_rate, elec_amount, total, paid, balance, line_sent_at, line_reminded_at, pay_method_chosen';

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Bills matching a filter, each with extras, tenant and the tenant's last payment choice. */
export async function loadBills(
  db: SupabaseClient,
  filter: { month?: string; ids?: string[]; contractIds?: string[]; open?: boolean },
): Promise<LoadedBill[]> {
  let q = db.from('bill_summary').select(BILL_COLS);
  if (filter.month) q = q.eq('month', filter.month);
  if (filter.ids) q = q.in('id', filter.ids);
  if (filter.contractIds) q = q.in('contract_id', filter.contractIds);
  if (filter.open) q = q.gt('balance', 0);
  const bills = must(await q.order('month')) as unknown as BillRow[];
  if (bills.length === 0) return [];

  const billIds = bills.map((b) => b.id);
  const contractIds = [...new Set(bills.map((b) => b.contract_id).filter((x): x is string => !!x))];
  const [extras, contracts, choices] = await Promise.all([
    db.from('bill_extras').select('bill_id, label, amount').in('bill_id', billIds).order('created_at').then(must),
    contractIds.length
      ? db.from('contracts').select('id, tenants(id, full_name, nickname, line_user_id)').in('id', contractIds).then(must)
      : Promise.resolve([]),
    // The most recent choice made on any earlier bill of the same contract.
    contractIds.length
      ? db.from('bills').select('contract_id, month, pay_method_chosen').in('contract_id', contractIds)
          .not('pay_method_chosen', 'is', null).order('month', { ascending: false }).then(must)
      : Promise.resolve([]),
  ]);
  const tenantOf = new Map((contracts as unknown as { id: string; tenants: Tenant | null }[]).map((c) => [c.id, c.tenants]));
  const choiceRows = choices as { contract_id: string; month: string; pay_method_chosen: string }[];

  return bills.map((bill) => ({
    bill,
    extras: (extras as { bill_id: string; label: string; amount: number }[]).filter((x) => x.bill_id === bill.id),
    tenant: bill.contract_id ? tenantOf.get(bill.contract_id) ?? null : null,
    lastChoice: choiceRows.find((c) => c.contract_id === bill.contract_id && c.month < bill.month)?.pay_method_chosen ?? null,
  }));
}

export function forMessage(x: LoadedBill): BillForMessage {
  const b = x.bill;
  return {
    room: b.room_number, tenant: x.tenant, month: b.month, due_date: b.due_date, rent: b.rent,
    water_people: b.water_people, water_per_person: b.water_per_person, water_amount: b.water_amount,
    elec_prev: b.elec_prev, elec_curr: b.elec_curr, elec_units: b.elec_units, elec_rate: b.elec_rate, elec_amount: b.elec_amount,
    extras: x.extras, total: b.total, paid: b.paid, balance: b.balance,
  };
}

/** The three payment buttons for a bill, last month's choice first. */
export function payButtons(billId: string, lastChoice: string | null) {
  return payOrder(lastChoice).map((m) => ({ label: PAY_BUTTON[m].label, said: PAY_BUTTON[m].said, data: payPostback(m, billId) }));
}

export type SettingsRow = PayDetails & {
  auto_send_enabled: boolean; summary_line_user_id: string | null; dorm_name: string;
};

export async function loadSettings(db: SupabaseClient): Promise<SettingsRow> {
  return must(await db.from('settings')
    .select('dorm_name, promptpay_id, bank_name, bank_branch, bank_account_name, bank_account_number, office_location, office_hours, auto_send_enabled, summary_line_user_id')
    .eq('id', 1).single()) as SettingsRow;
}
