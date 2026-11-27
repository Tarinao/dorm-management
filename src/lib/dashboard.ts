/* Dashboard numbers, computed from rooms and bill_summary rows. Pure (no imports), so
 * scripts/test-billing.ts can check it. Money is summed in satang to avoid 0.1 + 0.2 drift. */

export interface DashRoom { id: string; number: string; status: string }
export interface DashBill {
  room_id: string | null; room_number: string | null; tenant_name: string; month: string | null;
  total: number | null; paid: number | null; balance: number | null; is_overdue: boolean | null; due_date: string | null;
}

export interface OverdueRoom { roomNumber: string; tenant: string; bills: number; amount: number; oldestDue: string }

const satang = (n: number | null | undefined) => Math.round(Number(n ?? 0) * 100);

/** The month the dashboard opens on: the latest bill month (not in the future) that has bills,
 *  so on the 1st it stays on last month until this month’s bills are made. */
export function defaultDashMonth(bills: DashBill[], current: string): string {
  const months = bills.map((b) => b.month ?? '').filter((m) => m && m <= current).sort();
  return months[months.length - 1] ?? current;
}

export function dashboardNumbers(rooms: DashRoom[], bills: DashBill[], month: string) {
  const byStatus: Record<string, number> = { occupied: 0, vacant: 0, reserved: 0, maintenance: 0 };
  for (const r of rooms) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const occupancy = rooms.length ? byStatus.occupied / rooms.length : 0;

  const ofMonth = bills.filter((b) => b.month === month);
  const expected = ofMonth.reduce((s, b) => s + satang(b.total), 0) / 100;
  const collected = ofMonth.reduce((s, b) => s + satang(b.paid), 0) / 100;
  const outstanding = bills.reduce((s, b) => s + satang(b.balance), 0) / 100;

  const map = new Map<string, OverdueRoom & { cents: number }>();
  for (const b of bills) {
    if (!b.is_overdue) continue;
    const key = b.room_id ?? b.room_number ?? '';
    const cur = map.get(key) ?? { roomNumber: b.room_number ?? '', tenant: b.tenant_name, bills: 0, amount: 0, cents: 0, oldestDue: b.due_date ?? '' };
    cur.bills += 1;
    cur.cents += satang(b.balance);
    if (b.due_date && b.due_date < cur.oldestDue) cur.oldestDue = b.due_date;
    if (!cur.tenant && b.tenant_name) cur.tenant = b.tenant_name;
    map.set(key, cur);
  }
  const overdue: OverdueRoom[] = [...map.values()]
    .map(({ cents, ...r }) => ({ ...r, amount: cents / 100 }))
    .sort((a, b) => a.oldestDue.localeCompare(b.oldestDue) || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));

  return {
    totalRooms: rooms.length, byStatus, occupancy,
    billsInMonth: ofMonth.length, expected, collected, collectRate: expected ? collected / expected : 0,
    outstanding, overdue,
    overdueTotal: overdue.reduce((s, r) => s + satang(r.amount), 0) / 100,
  };
}
