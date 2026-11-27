-- Due date of a new bill: the due day (settings.due_day) of the bill month, or the day the bill is
-- made (Bangkok date) if that is later. Before, a first bill made after the due day (e.g. a move-in
-- on the 27th) or bills generated late were overdue the moment they were made, and the daily LINE
-- reminder chased them at once. Bills already made keep their due date.
-- Only generate_bills() changes; it is otherwise the same as in 20261127111701.

create or replace function public.generate_bills(p_month date)
returns table (room_number text, outcome text, new_bill_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_month   date := date_trunc('month', p_month)::date;
  v_end     date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_usage   date := (date_trunc('month', p_month) - interval '1 month')::date;
  v_set     record;
  v_c       record;
  v_curr_id uuid;
  v_curr_k  text;
  v_curr_on date;
  v_curr_at timestamptz;
  v_curr_e  numeric;
  v_prev_e  numeric;
  v_bill    uuid;
  v_rent    boolean;
  v_use     boolean;
begin
  -- Nested so the service role never calls is_member() (which only logged-in users may execute).
  if current_user <> 'service_role' then
    if not public.is_member() then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  select electric_rate, due_day, common_fee into v_set from public.settings where id = 1;

  for v_c in
    select rm.id as room_id, rm.number, rm.default_rent, rm.water_per_person, rm.occupants,
           c.id as contract_id, c.start_date, c.moved_out_on
      from public.contracts c
      join public.rooms rm on rm.id = c.room_id
     where c.start_date <= v_end
       and (c.moved_out_on is null or c.moved_out_on > v_usage)
     order by rm.number, c.start_date, c.created_at
  loop
    room_number := v_c.number;
    new_bill_id := null;
    v_rent := v_c.moved_out_on is null or v_c.moved_out_on > v_month;   -- lives in M
    v_use  := v_c.start_date < v_month;                                  -- lived in M-1 (the query ensures it had not left)
    v_curr_e := 0; v_prev_e := 0;

    if exists (select 1 from public.bills b where b.contract_id = v_c.contract_id and b.month = v_month) then
      outcome := 'already_billed'; return next; continue;
    end if;

    if v_use then
      if not v_rent then
        -- final bill: up to the move-out reading
        select m.id, m.kind, m.read_on, m.created_at, m.electric
          into v_curr_id, v_curr_k, v_curr_on, v_curr_at, v_curr_e
          from public.meter_readings m
         where m.room_id = v_c.room_id and m.kind = 'move_out' and m.read_on = v_c.moved_out_on
         order by m.created_at desc
         limit 1;
      else
        select m.id, m.kind, m.read_on, m.created_at, m.electric
          into v_curr_id, v_curr_k, v_curr_on, v_curr_at, v_curr_e
          from public.meter_readings m
         where m.room_id = v_c.room_id and m.month = v_usage and m.kind = 'monthly'
         limit 1;
      end if;
      if not found then
        outcome := 'no_reading'; return next; continue;
      end if;

      select m.electric
        into v_prev_e
        from public.meter_readings m
       where m.room_id = v_c.room_id
         and m.id <> v_curr_id
         and (m.read_on,
              case m.kind when 'move_out' then 0 when 'move_in' then 1 else 2 end,
              m.created_at)
           < (v_curr_on,
              case v_curr_k when 'move_out' then 0 when 'move_in' then 1 else 2 end,
              v_curr_at)
       order by m.read_on desc,
                case m.kind when 'move_out' then 0 when 'move_in' then 1 else 2 end desc,
                m.created_at desc
       limit 1;
      if not found then
        outcome := 'no_previous_reading'; return next; continue;
      end if;

      if v_curr_e < v_prev_e then
        outcome := 'meter_backwards'; return next; continue;
      end if;
    end if;

    insert into public.bills (room_id, contract_id, month, rent_month, usage_month, rent, common_fee,
                              water_prev, water_curr, water_people, water_per_person,
                              elec_prev, elec_curr, elec_rate, due_date)
    values (v_c.room_id, v_c.contract_id, v_month,
            case when v_rent then v_month end,
            case when v_use then v_usage end,
            case when v_rent then v_c.default_rent else 0 end,
            case when v_rent then v_set.common_fee else 0 end,
            0, 0,
            case when v_use then v_c.occupants else 0 end,
            case when v_use then v_c.water_per_person else 0 end,
            v_prev_e, v_curr_e,
            case when v_use then v_set.electric_rate else 0 end,
            -- the due day of M, or the day the bill is made if that is later (a first bill after a
            -- mid-month move-in, or bills generated late, are never overdue the moment they exist)
            greatest(make_date(extract(year from v_month)::int, extract(month from v_month)::int, v_set.due_day),
                     (now() at time zone 'Asia/Bangkok')::date))
    on conflict (contract_id, month) where contract_id is not null do nothing
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
revoke execute on function public.generate_bills(date) from public, anon;
grant execute on function public.generate_bills(date) to authenticated, service_role;
