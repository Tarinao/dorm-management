-- Move-in from a reservation carries the guest's LINE account over to the new tenant.
--
-- A reservation made from a LINE viewing (or from LINE before viewings existed) has line_user_id.
-- Until now move_in() created the tenant WITHOUT a LINE link, so the tenant had to link their room
-- again in the bot. Now the link is set in the same transaction as the move-in, exactly like an
-- approved link request (line_display_name from line_users, line_linked_at = now()).
--
-- Not carried over when:
--   - that LINE account is linked to a tenant with an ACTIVE contract (a current tenant): the
--     link stays where it is, so bills / payment buttons / slips never switch room by surprise;
--   - the tenant moving in already has a LINE link (existing tenant passed as p_tenant_id).
-- Same signature, same rules and errors as 20261126101653 otherwise. No new tables.

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
  p_occupants        integer,
  p_reservation_id   uuid default null
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
  v_status   text;
  v_res      record;
  v_credit   numeric := 0;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select status into v_status from public.rooms where id = p_room_id for update;
  if exists (select 1 from public.contracts where room_id = p_room_id and status = 'active') then
    raise exception 'ROOM_HAS_ACTIVE_CONTRACT' using errcode = 'P0001';
  end if;
  if v_status = 'maintenance' then
    raise exception 'ROOM_IN_MAINTENANCE' using errcode = 'P0001';
  end if;

  if p_reservation_id is not null then
    select * into v_res from public.reservations where id = p_reservation_id for update;
    if not found or v_res.status not in ('pending', 'confirmed') then
      raise exception 'RESERVATION_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if v_res.room_id is distinct from p_room_id then
      raise exception 'RESERVATION_OTHER_ROOM' using errcode = 'P0001';
    end if;
    if v_res.booking_fee_paid_on is not null then
      v_credit := v_res.booking_fee;
    end if;
  end if;

  if exists (select 1 from public.reservations r
              where r.room_id = p_room_id and r.status = 'confirmed'
                and r.id is distinct from p_reservation_id) then
    raise exception 'ROOM_RESERVED_FOR_OTHER' using errcode = 'P0001';
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

  insert into public.contracts (room_id, tenant_id, start_date, end_date, monthly_rent, deposit, booking_fee_credit)
  values (p_room_id, v_tenant, p_start_date, p_end_date, v_rent, coalesce(p_deposit, 0), v_credit)
  returning id into v_contract;

  insert into public.meter_readings (room_id, kind, month, read_on, water, electric)
  values (p_room_id, 'move_in', date_trunc('month', p_start_date)::date, p_start_date, p_water, p_electric);

  update public.rooms
     set status = 'occupied',
         default_rent = v_rent,
         water_per_person = coalesce(v_water, water_per_person),
         occupants = coalesce(p_occupants, occupants)
   where id = p_room_id;

  if p_reservation_id is not null then
    update public.reservations
       set status = 'moved_in', tenant_id = v_tenant, contract_id = v_contract
     where id = p_reservation_id;

    -- NEW: the reservation's LINE account becomes the new tenant's LINE link (as if staff had
    -- approved a link request). Skipped when that LINE account belongs to a CURRENT tenant
    -- (active contract elsewhere: bills and slips must not move), or the tenant already has a link.
    if v_res.line_user_id is not null
       and (select t.line_user_id from public.tenants t where t.id = v_tenant) is null
       and not exists (select 1 from public.tenants t
                         join public.contracts c on c.tenant_id = t.id and c.status = 'active'
                        where t.line_user_id = v_res.line_user_id and t.id <> v_tenant) then
      -- a former tenant (no active contract) may still hold it: free it first (the column is UNIQUE)
      update public.tenants
         set line_user_id = null, line_display_name = '', line_linked_at = null
       where line_user_id = v_res.line_user_id and id <> v_tenant;
      update public.tenants
         set line_user_id = v_res.line_user_id,
             line_display_name = coalesce((select u.display_name from public.line_users u
                                            where u.line_user_id = v_res.line_user_id), ''),
             line_linked_at = now()
       where id = v_tenant;
    end if;
  end if;
  return v_contract;
end;
$$;
