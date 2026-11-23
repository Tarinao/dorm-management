-- 0007: the water meter is no longer read (water is a flat price per person, see 0006).
--   * meter_readings.water may be empty
--   * generate_bills ignores water readings: only the electric meter must go forwards,
--     and bills store 0 for the (unused) water meter columns
-- Readings may also be saved for vacant rooms (nothing to change: save_monthly_reading never
-- required a tenant; generate_bills still only bills rooms that have a contract in the month).
-- Non-destructive: no data is removed.

alter table public.meter_readings alter column water drop not null;

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

    select m.id, m.kind, m.read_on, m.created_at, m.electric
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

    select m.id, m.electric
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

    if v_curr.electric < v_prev.electric then
      outcome := 'meter_backwards'; return next; continue;
    end if;

    insert into public.bills (room_id, contract_id, month, rent,
                              water_prev, water_curr, water_people, water_per_person,
                              elec_prev, elec_curr, elec_rate, due_date)
    values (v_room.room_id, v_room.contract_id, v_month, v_room.default_rent,
            0, 0, v_room.occupants, v_room.water_per_person,
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
