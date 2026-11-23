-- 0006: water is a flat monthly price PER PERSON, chosen per room (old customer 105 / new customer 150).
-- Each room remembers its water price, number of people and rent, so next month's bills start from them.
--   water on a bill = room.occupants x room.water_per_person   (the water meter is still recorded, for reference)
--   electric        = units x settings.electric_rate           (unchanged)
--   rent            = room.default_rent                        (kept in step with the active contract's rent)
-- Safe on the current data: bills is empty and settings has only the seeded row.

-- ---------------------------------------------------------------- settings: two water prices instead of one rate
alter table public.settings drop column water_rate;
alter table public.settings
  add column water_price_old numeric(10,2) not null default 105 check (water_price_old >= 0),
  add column water_price_new numeric(10,2) not null default 150 check (water_price_new >= 0);

-- ---------------------------------------------------------------- rooms remember their prices
alter table public.rooms
  add column water_per_person numeric(10,2) not null default 150 check (water_per_person >= 0),
  add column occupants        smallint      not null default 1   check (occupants between 0 and 20);

-- ---------------------------------------------------------------- bills: water is people x price per person
drop view public.bill_summary;

alter table public.bills drop column water_amount;
alter table public.bills drop column water_rate;
alter table public.bills
  add column water_people     smallint      not null default 0 check (water_people >= 0),
  add column water_per_person numeric(10,2) not null default 0 check (water_per_person >= 0);
alter table public.bills
  add column water_amount numeric(10,2) generated always as (round(water_people * water_per_person, 2)) stored;

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
  b.water_prev, b.water_curr, b.water_units, b.water_people, b.water_per_person, b.water_amount,
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

-- ---------------------------------------------------------------- room prices (rent + water + people) in one step
-- Also keeps the active contract's rent equal to the room's rent.
create function public.set_room_prices(
  p_room_id          uuid,
  p_rent             numeric,
  p_water_per_person numeric,
  p_occupants        integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.rooms
     set default_rent = p_rent, water_per_person = p_water_per_person, occupants = p_occupants
   where id = p_room_id;
  update public.contracts set monthly_rent = p_rent where room_id = p_room_id and status = 'active';
end;
$$;

-- ---------------------------------------------------------------- move in: also sets the room's prices
drop function public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric);

create function public.move_in(
  p_room_id          uuid,
  p_tenant_id        uuid,
  p_full_name        text,
  p_phone            text,
  p_id_card_ref      text,
  p_emergency_name   text,
  p_emergency_phone  text,
  p_start_date       date,
  p_end_date         date,
  p_monthly_rent     numeric,
  p_deposit          numeric,
  p_water            numeric,
  p_electric         numeric,
  p_water_per_person numeric,
  p_occupants        integer
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

  update public.rooms
     set status = 'occupied',
         default_rent = p_monthly_rent,
         water_per_person = coalesce(p_water_per_person, water_per_person),
         occupants = coalesce(p_occupants, occupants)
   where id = p_room_id;
  return v_contract;
end;
$$;

-- ---------------------------------------------------------------- generate bills: prices come from the room
create or replace function public.generate_bills(p_month date)
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

  select electric_rate, due_day into v_set from public.settings where id = 1;

  for v_room in
    select distinct on (rm.id) rm.id as room_id, rm.number, rm.default_rent, rm.water_per_person, rm.occupants,
           c.id as contract_id
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
                              water_prev, water_curr, water_people, water_per_person,
                              elec_prev, elec_curr, elec_rate, due_date)
    values (v_room.room_id, v_room.contract_id, v_month, v_room.default_rent,
            v_prev.water, v_curr.water, v_room.occupants, v_room.water_per_person,
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

-- ---------------------------------------------------------------- permissions for the new / changed functions
revoke execute on function
  public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric, numeric, integer),
  public.set_room_prices(uuid, numeric, numeric, integer)
from public, anon;

grant execute on function
  public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric, numeric, integer),
  public.set_room_prices(uuid, numeric, numeric, integer)
to authenticated;
