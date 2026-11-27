/* One-time import of the old app's data into the new tables.
 *
 *   Sources (both git-ignored, in ./data):
 *     data/live_backup_2026-11-23.json  export of the old Supabase tables, taken just before they were dropped
 *     data/old_tenants.json             backup file of the old Claude-artifact app
 *
 *   Usage:
 *     npm run import:old -- --dry-run                    read the database, print what WOULD happen, write nothing
 *     npm run import:old -- --dry-run --snapshot <file>  same, but compare against a JSON snapshot instead of the live DB
 *     npm run import:old -- --apply                      really write (asks nothing; run --dry-run first!)
 *
 *   Reading/writing the real database needs the service-role key, given ONLY in the terminal for this command:
 *     PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY="..."; npm run import:old -- --dry-run
 *     bash:        SUPABASE_SERVICE_ROLE_KEY=... npm run import:old -- --dry-run
 *   The URL is taken from VITE_SUPABASE_URL in .env. Never put the service-role key in a VITE_ variable.
 *
 *   Safe to run twice: everything already in the database is skipped ("already there"), and
 *   records that would overwrite something you entered in the new app are skipped, never overwritten. */
import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ input files */
interface LiveBackup {
  rooms: { number: string; floor: string; rent_base: number; status: string; notes: string }[];
  tenants: { room_number: string; full_name: string; phone: string | null; move_in: string | null; move_out: string | null;
    contract_end: string | null; deposit: number; occupants: number; notes: string; created_at: string; water_rate: number | null;
    id_number: string | null; id_card_last4: string | null; id_type: string | null }[];
  invoices: unknown[];
  repairs: unknown[];
  settings: { dorm_name: string; owner_name: string; water_per_person: number; elec_rate: number; common_fee: number; due_day: number;
    promptpay_type: string; promptpay_id: string; lang: string }[];
}
interface OldBackup {
  rooms: { number: string; floor: string; rentBase: number; status: string; notes: string; tenantName: string; tenantPhone: string;
    tenantIdCard: string; contractStart: string; contractEnd: string; deposit: number; occupants: number }[];
  bills: { room: string; month: string; rentAmount: number; elecPrev: number; elecCurr: number; elecRate: number; elecCost: number;
    waterPrev: number; waterCurr: number; waterRate: number; waterCost: number; commonFee: number; otherLabel: string; otherAmount: number;
    total: number; status: string; paidDate: string; dueDate: string; createdAt: string }[];
  repairs: unknown[];
  settings: Record<string, unknown>;
}

/** What the import compares against: the current state of the new database. */
export interface DbState {
  settings: { dorm_name: string; water_price_old: number; water_price_new: number; electric_rate: number; due_day: number; common_fee: number };
  rooms: { id: string; number: string; floor: number | null; default_rent: number; status: string; notes: string }[];
  active_contracts: { room_id: string; tenant_name: string }[];
  tenants: { id: string; full_name: string }[];
  bills: { room_id: string; month: string }[];
}

/* ------------------------------------------------------------------ plan */
type Section = 'settings' | 'rooms' | 'tenants' | 'bills' | 'repairs';
interface Item {
  section: Section;
  what: string;
  action: 'import' | 'skip';
  reason: string;
  write?: (db: Writer) => Promise<void>;
}
interface Writer {
  updateSettings(patch: Record<string, unknown>): Promise<void>;
  updateRoom(id: string, patch: Record<string, unknown>): Promise<void>;
  moveInImported(x: { roomId: string; fullName: string; phone: string; idCardRef: string; notes: string; start: string; end: string | null;
    rent: number; deposit: number; occupants: number }): Promise<void>;
  importBill(x: { roomId: string; month: string; rent: number; commonFee: number; elecPrev: number; elecCurr: number; elecRate: number; dueDate: string;
    extras: { label: string; amount: number }[]; payment: { amount: number; paidOn: string } | null }): Promise<void>;
}

const DEFAULT_DORM_NAME = 'My Dorm';
const DEFAULT_COMMON_FEE = 300;   // settings.common_fee default (migration 20261127111701)
const num = (v: unknown) => Number(v ?? 0);
const cents = (v: number) => Math.round(v * 100);
const money = (v: number) => '฿' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function buildPlan(live: LiveBackup, old: OldBackup, db: DbState): Item[] {
  const items: Item[] = [];
  const roomByNumber = new Map(db.rooms.map((r) => [r.number, r]));
  const activeByRoom = new Map(db.active_contracts.map((c) => [c.room_id, c.tenant_name]));

  /* ---- settings (live export is newer than the artifact backup) */
  const s = live.settings[0];
  const os = old.settings;
  if (!s) {
    items.push({ section: 'settings', what: 'settings', action: 'skip', reason: 'no settings row in the live export' });
  } else {
    const dorm = String(s.dorm_name ?? '').trim();
    if (!dorm) items.push({ section: 'settings', what: 'dorm name', action: 'skip', reason: 'empty in the old data' });
    else if (db.settings.dorm_name === dorm) items.push({ section: 'settings', what: `dorm name "${dorm}"`, action: 'skip', reason: 'already there' });
    else if (db.settings.dorm_name !== DEFAULT_DORM_NAME) {
      items.push({ section: 'settings', what: `dorm name "${dorm}"`, action: 'skip', reason: `already changed in the new app to "${db.settings.dorm_name}" (kept)` });
    } else {
      items.push({ section: 'settings', what: `dorm name "${db.settings.dorm_name}" → "${dorm}"`, action: 'import', reason: 'new app still has the default name',
        write: (w) => w.updateSettings({ dorm_name: dorm }) });
    }
    const same = (label: string, oldV: number, newV: number, col: string) => {
      if (num(oldV) === num(newV)) items.push({ section: 'settings', what: `${label} ${oldV}`, action: 'skip', reason: 'already there' });
      else items.push({ section: 'settings', what: `${label} ${oldV}`, action: 'skip',
        reason: `new app already has ${newV} (${col}); set by you after the move, so it is kept` });
    };
    same('electric rate', s.elec_rate, db.settings.electric_rate, 'electric_rate');
    same('water per person (old customers)', s.water_per_person, db.settings.water_price_old, 'water_price_old');
    same('due day', s.due_day, db.settings.due_day, 'due_day');
    items.push({ section: 'settings', what: 'owner name, PromptPay id/type, language', action: 'skip', reason: 'not used by the new app (PromptPay was removed)' });
    // Common fee: the new app has settings.common_fee (default 300). Taken over only while it is still the default.
    const oldFee = num(s.common_fee ?? os.commonFee);
    const dbFee = num(db.settings.common_fee ?? DEFAULT_COMMON_FEE);
    if (!(oldFee > 0)) items.push({ section: 'settings', what: `common fee ${oldFee}`, action: 'skip', reason: 'none in the old data; the new app keeps its own' });
    else if (oldFee === dbFee) items.push({ section: 'settings', what: `common fee ${oldFee}`, action: 'skip', reason: 'already there' });
    else if (dbFee !== DEFAULT_COMMON_FEE) {
      items.push({ section: 'settings', what: `common fee ${oldFee}`, action: 'skip', reason: `already changed in the new app to ${dbFee} (kept)` });
    } else {
      items.push({ section: 'settings', what: `common fee ${dbFee} → ${oldFee}`, action: 'import', reason: 'new app still has the default common fee',
        write: (w) => w.updateSettings({ common_fee: oldFee }) });
    }
    if (os.waterRate !== undefined) items.push({ section: 'settings', what: `old water rate ${os.waterRate} (per unit)`, action: 'skip', reason: 'water is now a flat price per person; the meter is not used' });
  }

  /* ---- rooms: rent / floor / notes. Live export first, artifact backup to cross-check. */
  const oldRooms = new Map(old.rooms.map((r) => [r.number, r]));
  const numbers = [...new Set([...live.rooms.map((r) => r.number), ...old.rooms.map((r) => r.number)])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const n of numbers) {
    const lr = live.rooms.find((r) => r.number === n);
    const or = oldRooms.get(n);
    const target = roomByNumber.get(n);
    if (!target) { items.push({ section: 'rooms', what: `room ${n}`, action: 'skip', reason: 'room does not exist in the new database' }); continue; }
    const rents = [lr?.rent_base, or?.rentBase].filter((x): x is number => x !== undefined && x !== null).map(Number);
    const patch: Record<string, unknown> = {};
    const notes: string[] = [];
    if (rents.length === 2 && rents[0] !== rents[1]) {
      notes.push(`rent differs between the two old files (live ${rents[0]}, backup ${rents[1]}); kept ${num(target.default_rent)} — change it in the app if needed`);
    } else if (rents.length && rents[0] !== num(target.default_rent)) {
      if (activeByRoom.has(target.id)) notes.push(`old rent ${rents[0]} not applied: room has a tenant now (${activeByRoom.get(target.id)}) at ${num(target.default_rent)}`);
      else patch.default_rent = rents[0];
    }
    const floor = Number(lr?.floor ?? or?.floor);
    if (Number.isFinite(floor) && floor !== target.floor) patch.floor = floor;
    const oldNotes = String(lr?.notes || or?.notes || '').trim();
    if (oldNotes && !target.notes.includes(oldNotes)) patch.notes = target.notes ? `${target.notes}\n${oldNotes}` : oldNotes;

    if (Object.keys(patch).length) {
      items.push({ section: 'rooms', what: `room ${n}: ${Object.entries(patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`,
        action: 'import', reason: notes.join('; ') || 'differs from the new database', write: (w) => w.updateRoom(target.id, patch) });
    } else {
      items.push({ section: 'rooms', what: `room ${n}`, action: 'skip', reason: notes.join('; ') || 'already up to date' });
    }
  }

  /* ---- tenants (each becomes tenant + active contract) */
  type T = { room: string; name: string; phone: string; idRef: string; start: string | null; end: string | null; deposit: number; occupants: number; notes: string; source: string };
  const candidates: T[] = [
    ...live.tenants.filter((x) => !x.move_out).map((x) => ({
      room: x.room_number, name: String(x.full_name ?? '').trim(), phone: x.phone ?? '',
      idRef: [x.id_type, x.id_number ?? (x.id_card_last4 ? `last 4: ${x.id_card_last4}` : null)].filter(Boolean).join(' '),
      start: isDate(x.move_in) ? x.move_in : isDate(x.created_at?.slice(0, 10)) ? x.created_at.slice(0, 10) : null,
      end: isDate(x.contract_end) ? x.contract_end : null, deposit: num(x.deposit), occupants: num(x.occupants), notes: x.notes ?? '',
      source: 'live export',
    })),
    ...old.rooms.filter((r) => r.tenantName || r.tenantPhone || r.tenantIdCard || r.contractStart || num(r.deposit) > 0).map((r) => ({
      room: r.number, name: String(r.tenantName ?? '').trim(), phone: r.tenantPhone ?? '', idRef: r.tenantIdCard ?? '',
      start: isDate(r.contractStart) ? r.contractStart : null, end: isDate(r.contractEnd) ? r.contractEnd : null,
      deposit: num(r.deposit), occupants: num(r.occupants), notes: '', source: 'artifact backup',
    })),
  ];
  const claimed = new Set<string>();
  for (const c of candidates) {
    const what = `${c.name || '(no name)'} in room ${c.room} [${c.source}]`;
    const room = roomByNumber.get(c.room);
    if (!c.name) { items.push({ section: 'tenants', what, action: 'skip', reason: `no tenant name (only contract data: start ${c.start ?? '-'}, deposit ${c.deposit})` }); continue; }
    if (!room) { items.push({ section: 'tenants', what, action: 'skip', reason: 'room does not exist in the new database' }); continue; }
    if (activeByRoom.has(room.id)) {
      const now = activeByRoom.get(room.id)!;
      items.push({ section: 'tenants', what, action: 'skip', reason: now.toLowerCase() === c.name.toLowerCase()
        ? 'already there' : `room already has a tenant in the new app ("${now}"); not overwritten` });
      continue;
    }
    if (claimed.has(room.id)) { items.push({ section: 'tenants', what, action: 'skip', reason: 'another old record for this room is imported instead' }); continue; }
    if (!c.start) { items.push({ section: 'tenants', what, action: 'skip', reason: 'no move-in date' }); continue; }
    claimed.add(room.id);
    items.push({ section: 'tenants', what, action: 'import',
      reason: `contract from ${c.start}, rent ${num(room.default_rent)}, deposit ${c.deposit}. No move-in meter reading in the old data: record the electric meter before the first bill`,
      write: (w) => w.moveInImported({ roomId: room.id, fullName: c.name, phone: c.phone, idCardRef: c.idRef, notes: c.notes,
        start: c.start!, end: c.end, rent: num(room.default_rent), deposit: c.deposit, occupants: Math.max(1, c.occupants) }) });
  }

  /* ---- bills (artifact backup; the live export has no invoices) */
  if (live.invoices.length) items.push({ section: 'bills', what: `${live.invoices.length} invoices in the live export`, action: 'skip', reason: 'live invoices are not supported by this script' });
  const billKeys = new Set(db.bills.map((b) => `${b.room_id}|${b.month.slice(0, 7)}`));
  for (const b of old.bills) {
    const what = `room ${b.room} ${b.month}, total ${money(num(b.total))} (${b.status})`;
    const room = roomByNumber.get(b.room);
    if (!room) { items.push({ section: 'bills', what, action: 'skip', reason: 'room does not exist in the new database' }); continue; }
    if (!/^\d{4}-\d{2}$/.test(b.month)) { items.push({ section: 'bills', what, action: 'skip', reason: `bad month "${b.month}"` }); continue; }
    if (billKeys.has(`${room.id}|${b.month}`)) { items.push({ section: 'bills', what, action: 'skip', reason: 'already there (a bill for this room and month exists)' }); continue; }
    if (num(b.elecCurr) < num(b.elecPrev)) { items.push({ section: 'bills', what, action: 'skip', reason: 'electric meter goes backwards' }); continue; }
    const elec = cents((num(b.elecCurr) - num(b.elecPrev)) * num(b.elecRate)) / 100;
    if (cents(elec) !== cents(num(b.elecCost))) { items.push({ section: 'bills', what, action: 'skip', reason: `electric cost ${b.elecCost} ≠ units × rate (${elec})` }); continue; }
    const extras = [
      ...(num(b.waterCost) > 0 ? [{ label: 'Water (old app) / ค่าน้ำ (ระบบเก่า)', amount: num(b.waterCost) }] : []),
      ...(num(b.otherAmount) > 0 ? [{ label: b.otherLabel || 'Other / อื่น ๆ', amount: num(b.otherAmount) }] : []),
    ];
    // The common fee goes on the bill's own common_fee (part of the total), not as an extra charge.
    const commonFee = Math.max(0, num(b.commonFee));
    const sum = cents(num(b.rentAmount)) + cents(commonFee) + cents(elec) + extras.reduce((s2, x) => s2 + cents(x.amount), 0);
    if (sum !== cents(num(b.total))) { items.push({ section: 'bills', what, action: 'skip', reason: `parts add up to ${money(sum / 100)}, not the total` }); continue; }
    const paid = b.status === 'paid';
    if (paid && !isDate(b.paidDate)) { items.push({ section: 'bills', what, action: 'skip', reason: 'marked paid but has no paid date' }); continue; }
    const due = isDate(b.dueDate) ? b.dueDate : `${b.month}-28`;
    items.push({ section: 'bills', what, action: 'import',
      reason: `rent ${b.rentAmount}${commonFee ? ` + common fee ${commonFee}` : ''} + electric ${elec} (${b.elecPrev}→${b.elecCurr} × ${b.elecRate})${extras.map((x) => ` + ${x.label.split(' /')[0].toLowerCase()} ${x.amount}`).join('')}` +
        (paid ? `; paid ${b.paidDate} → imported payment (method unknown)` : '; unpaid'),
      write: (w) => w.importBill({ roomId: room.id, month: `${b.month}-01`, rent: num(b.rentAmount), commonFee, elecPrev: num(b.elecPrev), elecCurr: num(b.elecCurr),
        elecRate: num(b.elecRate), dueDate: due, extras, payment: paid ? { amount: num(b.total), paidOn: b.paidDate } : null }) });
  }

  /* ---- repairs: feature removed */
  const repairs = live.repairs.length + old.repairs.length;
  items.push({ section: 'repairs', what: `${repairs} repair records`, action: 'skip', reason: repairs ? 'repairs were removed from the app' : 'none in the old data' });
  return items;
}

/* ------------------------------------------------------------------ database access (service role, apply / live dry-run) */
async function connect() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Need VITE_SUPABASE_URL (from .env) and SUPABASE_SERVICE_ROLE_KEY (set in this terminal only).\n' +
      'For a dry run without the key, pass --snapshot <file> (see README).');
    process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Client = Awaited<ReturnType<typeof connect>>;

function ok<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

async function readDb(sb: Client): Promise<DbState> {
  const settings = ok(await sb.from('settings').select('dorm_name, water_price_old, water_price_new, electric_rate, due_day, common_fee').eq('id', 1).single(), 'settings');
  const rooms = ok(await sb.from('rooms').select('id, number, floor, default_rent, status, notes'), 'rooms');
  const contracts = ok(await sb.from('contracts').select('room_id, tenants(full_name)').eq('status', 'active'), 'contracts') as unknown as { room_id: string; tenants: { full_name: string } | null }[];
  const tenants = ok(await sb.from('tenants').select('id, full_name'), 'tenants');
  const bills = ok(await sb.from('bills').select('room_id, month'), 'bills');
  return {
    settings, rooms, tenants, bills,
    active_contracts: contracts.map((c) => ({ room_id: c.room_id, tenant_name: c.tenants?.full_name ?? '' })),
  } as DbState;
}

function writer(sb: Client): Writer {
  return {
    async updateSettings(patch) { ok(await sb.from('settings').update(patch).eq('id', 1).select('id').single(), 'update settings'); },
    async updateRoom(id, patch) { ok(await sb.from('rooms').update(patch).eq('id', id).select('id').single(), 'update room'); },
    async moveInImported(x) {
      const t = ok(await sb.from('tenants').insert({ full_name: x.fullName, phone: x.phone, id_card_ref: x.idCardRef, notes: x.notes })
        .select('id').single(), 'insert tenant') as { id: string };
      try {
        ok(await sb.from('contracts').insert({ room_id: x.roomId, tenant_id: t.id, start_date: x.start, end_date: x.end,
          monthly_rent: x.rent, deposit: x.deposit }).select('id').single(), 'insert contract');
      } catch (e) { await sb.from('tenants').delete().eq('id', t.id); throw e; }
      ok(await sb.from('rooms').update({ status: 'occupied', occupants: x.occupants }).eq('id', x.roomId).select('id').single(), 'room occupied');
    },
    async importBill(x) {
      const b = ok(await sb.from('bills').insert({
        // Old bills: rent and electric of the same month (the old rule).
        room_id: x.roomId, contract_id: null, month: x.month, rent_month: x.month, usage_month: x.month, rent: x.rent, common_fee: x.commonFee,
        elec_prev: x.elecPrev, elec_curr: x.elecCurr,
        elec_rate: x.elecRate, water_people: 0, water_per_person: 0, due_date: x.dueDate, note: 'Imported from the old app',
      }).select('id').single(), 'insert bill') as { id: string };
      try {
        if (x.extras.length) ok(await sb.from('bill_extras').insert(x.extras.map((e) => ({ bill_id: b.id, ...e }))).select('id'), 'insert extras');
        if (x.payment) ok(await sb.from('payments').insert({ bill_id: b.id, amount: x.payment.amount, paid_on: x.payment.paidOn,
          method: null, imported: true, note: 'Imported from the old app' }).select('id').single(), 'insert payment');
      } catch (e) {   // undo the half-imported bill so a re-run starts clean
        await sb.from('payments').delete().eq('bill_id', b.id);
        await sb.from('bill_extras').delete().eq('bill_id', b.id);
        await sb.from('bills').delete().eq('id', b.id);
        throw e;
      }
    },
  };
}

/* ------------------------------------------------------------------ report */
function report(items: Item[], mode: string, source: string) {
  const sections: Section[] = ['settings', 'rooms', 'tenants', 'bills', 'repairs'];
  console.log(`\n=== Import of old data — ${mode} ===`);
  console.log(`Compared against: ${source}\n`);
  for (const s of sections) {
    const list = items.filter((i) => i.section === s);
    const imp = list.filter((i) => i.action === 'import');
    console.log(`--- ${s}: ${imp.length} to import, ${list.length - imp.length} skipped`);
    for (const i of imp) console.log(`  + ${i.what}\n      ${i.reason}`);
    // Group identical skip reasons so 40 "already up to date" rooms take one line.
    const groups = new Map<string, string[]>();
    for (const i of list.filter((x) => x.action === 'skip')) groups.set(i.reason, [...(groups.get(i.reason) ?? []), i.what]);
    for (const [reason, whats] of groups) {
      if (whats.length > 3) console.log(`  - ${whats.length}× skipped: ${reason}\n      (${whats.join(', ')})`);
      else for (const w of whats) console.log(`  - ${w}\n      skipped: ${reason}`);
    }
  }
  const imp = items.filter((i) => i.action === 'import').length;
  console.log(`\nTOTAL: ${imp} to import, ${items.length - imp} skipped (${items.length} records)`);
}

/* ------------------------------------------------------------------ main */
async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run'), apply = args.includes('--apply');
  if (dry === apply) {
    console.error('Choose one: --dry-run (writes nothing) or --apply (writes to the database).');
    process.exit(2);
  }
  const arg = (name: string, def: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const live = JSON.parse(readFileSync(arg('--live', 'data/live_backup_2026-11-23.json'), 'utf8')) as LiveBackup;
  const old = JSON.parse(readFileSync(arg('--old', 'data/old_tenants.json'), 'utf8')) as OldBackup;
  const snapshot = args.includes('--snapshot') ? arg('--snapshot', '') : '';
  if (apply && snapshot) { console.error('--snapshot is only for --dry-run.'); process.exit(2); }

  let db: DbState, sb: Client | null = null, source: string;
  if (snapshot) {
    db = JSON.parse(readFileSync(snapshot, 'utf8')) as DbState;
    source = `snapshot file ${snapshot}`;
  } else {
    sb = await connect();
    db = await readDb(sb);
    source = `live database ${new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!).host}`;
  }

  const items = buildPlan(live, old, db);
  report(items, dry ? 'DRY RUN (nothing written)' : 'APPLY', source);
  if (dry) return;

  console.log('\nWriting…');
  const w = writer(sb!);
  let done = 0, failed = 0;
  for (const i of items.filter((x) => x.action === 'import')) {
    try { await i.write!(w); done++; console.log(`  ok    ${i.section}: ${i.what}`); }
    catch (e) { failed++; process.exitCode = 1; console.log(`  FAIL  ${i.section}: ${i.what}\n        ${(e as Error).message}`); }
  }
  console.log(`\nImported ${done}, failed ${failed}, skipped ${items.length - done - failed}.`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
