-- 0004: bill summary view, payment guard, and the multi-step actions as single
-- transactions (move-in, move-out, save monthly reading, generate bills).
-- Every function here is SECURITY INVOKER: it runs with the caller's rights, so the
-- RLS policies from 0003 still apply.

-- ---------------------------------------------------------------- bill_summary
-- total   = rent + water + electric + extras
-- status  = paid (balance <= 0) / partial (something paid) / unpaid
-- overdue = balance > 0 and due date has passed (Bangkok time)
create view public.bill_summary
with (security_invoker = true)
as
select
  b.id,
  b.room_id,
  r.number                                             as room_number,
  b.contract_id,
  b.month,
  b.rent,
  b.water_prev, b.water_curr, b.water_units, b.water_rate, b.water_amount,
  b.elec_prev,  b.elec_curr,  b.elec_units,  b.elec_rate,  b.elec_amount,
  b.due_date,
  b.note,
  b.created_at,
  coalesce(x.extras_total, 0)                                                  as extras_total,
  b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0)        as total,
  coalesce(p.paid, 0)                                                          as paid,
  b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0)
    - coalesce(p.paid, 0)                                                      as balance,
  case
    when b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0) - coalesce(p.paid, 0) <= 0 then 'paid'
    when coalesce(p.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end                                                                          as status,
  (b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0) - coalesce(p.paid, 0) > 0
    and b.due_date < (now() at time zone 'Asia/Bangkok')::date)                as is_overdue,
  p.last_paid_on
from public.bills b
join public.rooms r on r.id = b.room_id
left join lateral (
  select sum(e.amount) as extras_total from public.bill_extras e where e.bill_id = b.id
) x on true
left join lateral (
  select sum(pm.amount) as paid, max(pm.paid_on) as last_paid_on from public.payments pm where pm.bill_id = b.id
) p on true;

revoke all on public.bill_summary from anon;
grant select on public.bill_summary to authenticated, service_role;

-- ---------------------------------------------------------------- payment guard
-- A payment can never take the amount paid above the bill total.
create function public.check_payment_not_over()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_total numeric;
  v_paid  numeric;
begin
  -- lock the bill so two people paying at the same moment are checked one after the other
  perform 1 from public.bills where id = new.bill_id for update;

  select b.rent + b.water_amount + b.elec_amount
         + coalesce((select sum(e.amount) from public.bill_extras e where e.bill_id = b.id), 0)
    into v_total
    from public.bills b
   where b.id = new.bill_id;

  select coalesce(sum(amount), 0) into v_paid
    from public.payments
   where bill_id = new.bill_id and id <> new.id;

  if v_paid + new.amount > v_total then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: balance is %', v_total - v_paid using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger payments_not_over_total
  before insert or update of amount, bill_id on public.payments
  for each row execute function public.check_payment_not_over();

-- ---------------------------------------------------------------- settings.updated_at
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- move in
-- New tenant (or an existing one via p_tenant_id) + contract + starting meter readings,
-- and the room becomes occupied. All or nothing.
create function public.move_in(
  p_room_id         uuid,
  p_tenant_id       uuid,
  p_full_name       text,
  p_phone           text,
  p_id_card_ref     text,
  p_emergency_name  text,
  p_emergency_phone text,
  p_start_date      date,
  p_end_date        date,
  p_monthly_rent    numeric,
  p_deposit         numeric,
  p_water           numeric,
  p_electric        numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant   uuid := p_tenant_id;
  v_contract uuid;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if exists (select 1 from public.contracts where room_id = p_room_id and status = 'active') then
    raise exception 'ROOM_HAS_ACTIVE_CONTRACT' using errcode = 'P0001';
  end if;

  if v_tenant is null then
    insert into public.tenants (full_name, phone, id_card_ref, emergency_name, emergency_phone)
    values (btrim(p_full_name), coalesce(p_phone, ''), coalesce(p_id_card_ref, ''),
            coalesce(p_emergency_name, ''), coalesce(p_emergency_phone, ''))
    returning id into v_tenant;
  end if;

  insert into public.contracts (room_id, tenant_id, start_date, end_date, monthly_rent, deposit)
  values (p_room_id, v_tenant, p_start_date, p_end_date, p_monthly_rent, coalesce(p_deposit, 0))
  returning id into v_contract;

  insert into public.meter_readings (room_id, kind, month, read_on, water, electric)
  values (p_room_id, 'move_in', date_trunc('month', p_start_date)::date, p_start_date, p_water, p_electric);

  update public.rooms set status = 'occupied' where id = p_room_id;
  return v_contract;
end;
$$;

-- ---------------------------------------------------------------- move out
-- Final meter readings, contract ended, deposit returned, room set to vacant/maintenance/reserved.
create function public.move_out(
  p_contract_id      uuid,
  p_date             date,
  p_water            numeric,
  p_electric         numeric,
  p_deposit_returned numeric,
  p_note             text,
  p_room_status      text default 'vacant'
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room uuid;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_room_status not in ('vacant', 'maintenance', 'reserved') then
    raise exception 'BAD_ROOM_STATUS' using errcode = 'P0001';
  end if;

  select room_id into v_room from public.contracts where id = p_contract_id and status = 'active' for update;
  if v_room is null then
    raise exception 'CONTRACT_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  insert into public.meter_readings (room_id, kind, month, read_on, water, electric)
  values (v_room, 'move_out', date_trunc('month', p_date)::date, p_date, p_water, p_electric);

  update public.contracts
     set status = 'ended', moved_out_on = p_date,
         deposit_returned = p_deposit_returned, move_out_note = coalesce(p_note, '')
   where id = p_contract_id;

  update public.rooms set status = p_room_status where id = v_room;
end;
$$;

-- ---------------------------------------------------------------- monthly reading (insert or correct)
create function public.save_monthly_reading(
  p_room_id  uuid,
  p_month    date,
  p_read_on  date,
  p_water    numeric,
  p_electric numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.meter_readings (room_id, kind, month, read_on, water, electric)
  values (p_room_id, 'monthly', date_trunc('month', p_month)::date, p_read_on, p_water, p_electric)
  on conflict (room_id, month) where kind = 'monthly'
  do update set read_on = excluded.read_on, water = excluded.water,
                electric = excluded.electric, recorded_by = auth.uid()
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- generate bills
-- Creates one bill per room that has a contract during the month. The same rule is
-- mirrored in src/lib/billing.ts for the on-screen preview and the unit test.
--   current reading  = the room's monthly reading for the month (else its move-out reading in the month)
--   previous reading = the latest reading before it (order: date, then move_out < move_in < monthly)
--   rent             = the contract's monthly rent; rates come from settings
--   due date         = settings.due_day of the following month
-- Outcomes: created | already_billed | no_reading | no_previous_reading | meter_backwards
create function public.generate_bills(p_month date)
returns table (room_number text, outcome text, new_bill_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_next  date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_set   record;
  v_room  record;
  v_curr  record;
  v_prev  record;
  v_bill  uuid;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select water_rate, electric_rate, due_day into v_set from public.settings where id = 1;

  for v_room in
    select distinct on (rm.id) rm.id as room_id, rm.number, c.id as contract_id, c.monthly_rent
      from public.rooms rm
      join public.contracts c on c.room_id = rm.id
     where c.start_date <= v_end
       and (c.moved_out_on is null or c.moved_out_on >= v_month)
     order by rm.id, c.start_date desc, c.created_at desc
  loop
    room_number := v_room.number;
    new_bill_id := null;

    if exists (select 1 from public.bills b where b.room_id = v_room.room_id and b.month = v_month) then
      outcome := 'already_billed'; return next; continue;
    end if;

    select m.id, m.kind, m.read_on, m.created_at, m.water, m.electric
      into v_curr
      from public.meter_readings m
     where m.room_id = v_room.room_id
       and m.month = v_month
       and m.kind in ('monthly', 'move_out')
     order by (m.kind = 'monthly') desc, m.read_on desc, m.created_at desc
     limit 1;
    if not found then
      outcome := 'no_reading'; return next; continue;
    end if;

    select m.id, m.water, m.electric
      into v_prev
      from public.meter_readings m
     where m.room_id = v_room.room_id
       and m.id <> v_curr.id
       and (m.read_on,
            case m.kind when 'move_out' then 0 when 'move_in' then 1 else 2 end,
            m.created_at)
         < (v_curr.read_on,
            case v_curr.kind when 'move_out' then 0 when 'move_in' then 1 else 2 end,
            v_curr.created_at)
     order by m.read_on desc,
              case m.kind when 'move_out' then 0 when 'move_in' then 1 else 2 end desc,
              m.created_at desc
     limit 1;
    if not found then
      outcome := 'no_previous_reading'; return next; continue;
    end if;

    if v_curr.water < v_prev.water or v_curr.electric < v_prev.electric then
      outcome := 'meter_backwards'; return next; continue;
    end if;

    insert into public.bills (room_id, contract_id, month, rent,
                              water_prev, water_curr, water_rate,
                              elec_prev, elec_curr, elec_rate, due_date)
    values (v_room.room_id, v_room.contract_id, v_month, v_room.monthly_rent,
            v_prev.water, v_curr.water, v_set.water_rate,
            v_prev.electric, v_curr.electric, v_set.electric_rate,
            make_date(extract(year from v_next)::int, extract(month from v_next)::int, v_set.due_day))
    on conflict (room_id, month) do nothing
    returning id into v_bill;

    if v_bill is null then
      outcome := 'already_billed';
    else
      outcome := 'created'; new_bill_id := v_bill;
    end if;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- function permissions
revoke execute on function
  public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric),
  public.move_out(uuid, date, numeric, numeric, numeric, text, text),
  public.save_monthly_reading(uuid, date, date, numeric, numeric),
  public.generate_bills(date)
from public, anon;

grant execute on function
  public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric),
  public.move_out(uuid, date, numeric, numeric, numeric, text, text),
  public.save_monthly_reading(uuid, date, date, numeric, numeric),
  public.generate_bills(date)
to authenticated;
