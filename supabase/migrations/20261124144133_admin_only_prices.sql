-- 0008: room prices (rent, water price per person, people) can only be changed by the owner (admin).
--
-- * set_room_prices() refuses anyone who is not admin.
-- * A trigger blocks staff from changing rooms.default_rent / rooms.water_per_person or a contract's
--   monthly_rent through the normal table API, so the rule holds even outside the app.
-- * move_in(): staff can still check tenants in, but the rent and water price always come from the
--   room (whatever the app sends is ignored). Staff can still enter how many people move in.
-- * Server-side tools (service_role, e.g. the import script) and the SQL editor are not affected.

-- ---------------------------------------------------------------- set_room_prices: admin only
create or replace function public.set_room_prices(
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
  if not public.is_admin() then
    raise exception 'PRICE_ADMIN_ONLY' using errcode = '42501';
  end if;
  update public.rooms
     set default_rent = p_rent, water_per_person = p_water_per_person, occupants = p_occupants
   where id = p_room_id;
  update public.contracts set monthly_rent = p_rent where room_id = p_room_id and status = 'active';
end;
$$;

-- ---------------------------------------------------------------- guard: staff cannot change prices directly
create function public.guard_prices()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only signed-in app users are checked; service_role / postgres (import, SQL editor) pass.
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;

  if tg_table_name = 'rooms' then
    if new.default_rent is distinct from old.default_rent
       or new.water_per_person is distinct from old.water_per_person then
      raise exception 'PRICE_ADMIN_ONLY' using errcode = '42501';
    end if;
  elsif tg_table_name = 'contracts' then
    if tg_op = 'INSERT' then
      if new.monthly_rent is distinct from (select r.default_rent from public.rooms r where r.id = new.room_id) then
        raise exception 'PRICE_ADMIN_ONLY' using errcode = '42501';
      end if;
    elsif new.monthly_rent is distinct from old.monthly_rent then
      raise exception 'PRICE_ADMIN_ONLY' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger rooms_guard_prices
  before update of default_rent, water_per_person on public.rooms
  for each row execute function public.guard_prices();

create trigger contracts_guard_prices
  before insert or update of monthly_rent on public.contracts
  for each row execute function public.guard_prices();

revoke execute on function public.guard_prices() from public, anon, authenticated;

-- ---------------------------------------------------------------- move_in: staff use the room's prices
create or replace function public.move_in(
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
  v_rent     numeric := p_monthly_rent;
  v_water    numeric := p_water_per_person;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if exists (select 1 from public.contracts where room_id = p_room_id and status = 'active') then
    raise exception 'ROOM_HAS_ACTIVE_CONTRACT' using errcode = 'P0001';
  end if;

  if not public.is_admin() then
    select r.default_rent, r.water_per_person into v_rent, v_water from public.rooms r where r.id = p_room_id;
  end if;

  if v_tenant is null then
    insert into public.tenants (full_name, phone, id_card_ref, emergency_name, emergency_phone)
    values (btrim(p_full_name), coalesce(p_phone, ''), coalesce(p_id_card_ref, ''),
            coalesce(p_emergency_name, ''), coalesce(p_emergency_phone, ''))
    returning id into v_tenant;
  end if;

  insert into public.contracts (room_id, tenant_id, start_date, end_date, monthly_rent, deposit)
  values (p_room_id, v_tenant, p_start_date, p_end_date, v_rent, coalesce(p_deposit, 0))
  returning id into v_contract;

  insert into public.meter_readings (room_id, kind, month, read_on, water, electric)
  values (p_room_id, 'move_in', date_trunc('month', p_start_date)::date, p_start_date, p_water, p_electric);

  update public.rooms
     set status = 'occupied',
         default_rent = v_rent,
         water_per_person = coalesce(v_water, water_per_person),
         occupants = coalesce(p_occupants, occupants)
   where id = p_room_id;
  return v_contract;
end;
$$;
