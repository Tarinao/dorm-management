-- 0012: reservations (bookings) and maintenance tickets.
--
-- reservations
--   * At most ONE pending or confirmed reservation per room (unique partial index; the trigger
--     also checks first so the app gets a clear error code).
--   * A room can be reserved only when it is vacant, or occupied with a known move-out date
--     (the active contract's end_date) that is on or before the desired move-in date.
--     A room in maintenance (or with an open "block room" ticket) cannot be reserved.
--   * Confirming sets a vacant room to 'reserved'. Cancelling / expiring / deleting a confirmed
--     reservation puts the room back to its correct status (occupied / maintenance / vacant).
--   * Booking fee: amount, date paid, method (cash / transfer) and a receipt number B-000001.
--   * Requests from the LINE bot arrive as PENDING with no room yet (room_id null); staff choose a
--     room before confirming. Nothing is ever confirmed automatically.
--   * expires_on defaults to desired_move_in + 7 days (editable). expire_reservations() runs daily.
--   * Convert to move-in: move_in(..., p_reservation_id) marks the reservation moved_in and
--     credits a paid booking fee to the new contract (contracts.booking_fee_credit).
--
-- maintenance_tickets
--   * block_room: while the ticket is open / in progress, a VACANT room is set to 'maintenance'
--     (cannot be reserved or moved into). Closing the ticket (done / cancelled) or turning the
--     block off frees the room again. Occupied rooms keep their status.
--   * Photos in the private storage bucket "maintenance" (members read / upload, admin deletes).
--
-- RLS on both tables: members (admin + staff) read / add / edit, only admin deletes.
-- Non-destructive: only adds tables, columns, functions, policies, a bucket and a cron job.

-- ================================================================ maintenance tickets
create table public.maintenance_tickets (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete restrict,
  title        text not null check (btrim(title) <> '' and length(title) <= 120),
  description  text not null default '' check (length(description) <= 4000),
  category     text not null default 'other' check (category in ('electric', 'water', 'ac', 'furniture', 'other')),
  priority     text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  status       text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  reported_by  text not null default 'staff' check (reported_by in ('staff', 'tenant', 'line')),
  block_room   boolean not null default false,
  photos       text[] not null default '{}',            -- paths in the private "maintenance" bucket
  cost         numeric(10,2) check (cost >= 0),
  assigned_to  text not null default '' check (length(assigned_to) <= 100),
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  check ((status in ('done', 'cancelled')) = (closed_at is not null))
);
create index maintenance_room_idx on public.maintenance_tickets (room_id, opened_at desc);
create index maintenance_open_idx on public.maintenance_tickets (status, priority) where status in ('open', 'in_progress');

-- ================================================================ reservations
create sequence public.booking_receipt_seq;

create table public.reservations (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid references public.rooms (id) on delete restrict,   -- null: LINE request, room not chosen yet
  guest_name           text not null check (btrim(guest_name) <> '' and length(guest_name) <= 100),
  phone                text not null default '' check (length(phone) <= 30),
  line_user_id         text check (line_user_id ~ '^U[0-9a-f]{32}$'),
  desired_move_in      date not null,
  booking_fee          numeric(10,2) not null default 0 check (booking_fee >= 0),
  booking_fee_paid_on  date,
  booking_fee_method   text check (booking_fee_method in ('cash', 'transfer')),
  booking_receipt_no   text unique,                       -- B-000001, given when the fee is recorded
  status               text not null default 'pending'
                       check (status in ('pending', 'confirmed', 'cancelled', 'expired', 'moved_in')),
  expires_on           date not null,                     -- trigger fills desired_move_in + 7 when not given
  note                 text not null default '' check (length(note) <= 2000),
  source               text not null default 'staff' check (source in ('staff', 'line')),
  tenant_id            uuid references public.tenants (id) on delete restrict,     -- set by move_in
  contract_id          uuid references public.contracts (id) on delete restrict,   -- set by move_in
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((booking_fee_paid_on is null) = (booking_fee_method is null)),
  check (booking_fee_paid_on is null or booking_fee > 0),
  check (status not in ('confirmed', 'moved_in') or room_id is not null),
  check ((status = 'moved_in') = (contract_id is not null))
);
-- THE double-booking rule: one active (pending or confirmed) reservation per room.
create unique index reservations_one_active_per_room on public.reservations (room_id) where status in ('pending', 'confirmed');
create index reservations_status_idx on public.reservations (status, desired_move_in);

-- contracts: the booking fee counted toward the deposit (0 when the move-in had no reservation).
alter table public.contracts
  add column booking_fee_credit numeric(10,2) not null default 0 check (booking_fee_credit >= 0);

-- ---------------------------------------------------------------- helper
-- What a room's status should be when nothing manual is involved.
create function public.natural_room_status(p_room_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (select 1 from public.contracts c where c.room_id = p_room_id and c.status = 'active') then 'occupied'
    when exists (select 1 from public.maintenance_tickets m
                  where m.room_id = p_room_id and m.block_room and m.status in ('open', 'in_progress')) then 'maintenance'
    when exists (select 1 from public.reservations r where r.room_id = p_room_id and r.status = 'confirmed') then 'reserved'
    else 'vacant'
  end;
$$;

-- ---------------------------------------------------------------- can this room be reserved?
-- Raises a clear error code when not. p_self = the reservation being saved (ignored in the check).
create function public.assert_room_reservable(p_room_id uuid, p_desired date, p_self uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_end    date;
begin
  select status into v_status from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.reservations r
              where r.room_id = p_room_id and r.status in ('pending', 'confirmed') and r.id <> p_self) then
    raise exception 'ROOM_ALREADY_RESERVED' using errcode = 'P0001';
  end if;

  if v_status = 'maintenance'
     or exists (select 1 from public.maintenance_tickets m
                 where m.room_id = p_room_id and m.block_room and m.status in ('open', 'in_progress')) then
    raise exception 'ROOM_IN_MAINTENANCE' using errcode = 'P0001';
  end if;

  if v_status = 'occupied' then
    select c.end_date into v_end from public.contracts c where c.room_id = p_room_id and c.status = 'active';
    if v_end is null then
      raise exception 'ROOM_NO_MOVE_OUT_DATE' using errcode = 'P0001';
    end if;
    if p_desired < v_end then
      raise exception 'MOVE_IN_BEFORE_MOVE_OUT' using errcode = 'P0001';
    end if;
  elsif v_status = 'reserved' then
    -- 'reserved' set by hand (no reservation row) or held by another booking.
    if not exists (select 1 from public.reservations r
                    where r.room_id = p_room_id and r.id = p_self and r.status = 'confirmed') then
      raise exception 'ROOM_ALREADY_RESERVED' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------- before insert / update
create function public.reservations_before()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.guest_name := btrim(new.guest_name);
  new.phone := btrim(coalesce(new.phone, ''));

  -- expires_on: default 7 days after the desired move-in, and it follows the move-in date
  -- when that changes, unless staff had set their own expiry.
  if new.expires_on is null then
    new.expires_on := new.desired_move_in + 7;
  elsif tg_op = 'UPDATE' and new.desired_move_in is distinct from old.desired_move_in
        and new.expires_on = old.expires_on and old.expires_on = old.desired_move_in + 7 then
    new.expires_on := new.desired_move_in + 7;
  end if;

  if new.booking_fee_paid_on is not null and new.booking_receipt_no is null then
    new.booking_receipt_no := 'B-' || lpad(nextval('public.booking_receipt_seq')::text, 6, '0');
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'confirmed') then
      raise exception 'BAD_RESERVATION_STATUS' using errcode = 'P0001';
    end if;
  else
    new.updated_at := now();
    if new.status is distinct from old.status then
      if old.status in ('cancelled', 'expired', 'moved_in') then
        raise exception 'RESERVATION_CLOSED' using errcode = 'P0001';
      end if;
      if old.status = 'confirmed' and new.status = 'pending' then
        raise exception 'BAD_RESERVATION_STATUS' using errcode = 'P0001';
      end if;
    elsif old.status in ('cancelled', 'expired', 'moved_in')
          and (new.room_id is distinct from old.room_id or new.desired_move_in is distinct from old.desired_move_in) then
      raise exception 'RESERVATION_CLOSED' using errcode = 'P0001';
    end if;
  end if;

  -- The room rules, whenever a reservation becomes active on a room or changes room / date.
  if new.room_id is not null and new.status in ('pending', 'confirmed')
     and (tg_op = 'INSERT'
          or new.room_id is distinct from old.room_id
          or new.status is distinct from old.status
          or new.desired_move_in is distinct from old.desired_move_in) then
    perform public.assert_room_reservable(new.room_id, new.desired_move_in, new.id);
  end if;
  return new;
end;
$$;

create trigger reservations_before
  before insert or update on public.reservations
  for each row execute function public.reservations_before();

-- ---------------------------------------------------------------- after: keep rooms.status in step
create function public.reservations_after()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A confirmed reservation stopped holding its room: give the room back its natural status.
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'confirmed' and old.room_id is not null
     and (tg_op = 'DELETE' or new.status <> 'confirmed' or new.room_id is distinct from old.room_id) then
    update public.rooms set status = public.natural_room_status(old.room_id)
     where id = old.room_id and status = 'reserved';
  end if;

  -- Newly confirmed: a vacant room becomes 'reserved' (an occupied one stays occupied until move-out).
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status <> 'confirmed' or new.room_id is distinct from old.room_id) then
    update public.rooms set status = 'reserved' where id = new.room_id and status = 'vacant';
  end if;
  return null;
end;
$$;

create trigger reservations_after
  after insert or update or delete on public.reservations
  for each row execute function public.reservations_after();

-- ---------------------------------------------------------------- maintenance: before / after
create function public.maintenance_before()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.room_id is distinct from old.room_id then
    raise exception 'TICKET_ROOM_FIXED' using errcode = 'P0001';
  end if;
  if new.status in ('done', 'cancelled') then
    if tg_op = 'UPDATE' and old.status in ('done', 'cancelled') then
      new.closed_at := coalesce(new.closed_at, old.closed_at, now());   -- still closed: keep the date
    else
      new.closed_at := now();                                            -- closed just now
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger maintenance_before
  before insert or update on public.maintenance_tickets
  for each row execute function public.maintenance_before();

create function public.maintenance_after()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room       uuid := coalesce(new.room_id, old.room_id);
  v_was_block  boolean := tg_op in ('UPDATE', 'DELETE') and old.block_room and old.status in ('open', 'in_progress');
  v_is_block   boolean := tg_op in ('INSERT', 'UPDATE') and new.block_room and new.status in ('open', 'in_progress');
  v_any_block  boolean;
begin
  select exists (select 1 from public.maintenance_tickets m
                  where m.room_id = v_room and m.block_room and m.status in ('open', 'in_progress'))
    into v_any_block;

  if v_is_block then
    -- Block a vacant room. Occupied / reserved rooms keep their status.
    update public.rooms set status = 'maintenance' where id = v_room and status = 'vacant';
  elsif v_was_block and not v_any_block then
    -- This ticket was the (last) block: free the room.
    update public.rooms set status = public.natural_room_status(v_room)
     where id = v_room and status = 'maintenance';
  end if;
  return null;
end;
$$;

create trigger maintenance_after
  after insert or update or delete on public.maintenance_tickets
  for each row execute function public.maintenance_after();

-- ================================================================ move in (+ reservation)
-- Same as 0008, plus:
--   * refuses a room in maintenance (ROOM_IN_MAINTENANCE)
--   * refuses a room held by someone else's confirmed reservation (ROOM_RESERVED_FOR_OTHER)
--   * p_reservation_id: "Convert to move-in". The reservation becomes moved_in (with tenant and
--     contract), and a paid booking fee is credited toward the deposit (contracts.booking_fee_credit).
drop function public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric, numeric, integer);

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
  end if;
  return v_contract;
end;
$$;

-- ================================================================ move out: honour bookings and blocks
-- Same as 0009, except a requested 'vacant' becomes 'maintenance' when a "block room" ticket is
-- open, or 'reserved' when a confirmed reservation is waiting for the room.
create or replace function public.move_out(
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
  v_room   uuid;
  v_tenant uuid;
  v_status text := p_room_status;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_room_status not in ('vacant', 'maintenance', 'reserved') then
    raise exception 'BAD_ROOM_STATUS' using errcode = 'P0001';
  end if;

  select room_id, tenant_id into v_room, v_tenant
    from public.contracts where id = p_contract_id and status = 'active' for update;
  if v_room is null then
    raise exception 'CONTRACT_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  insert into public.meter_readings (room_id, kind, month, read_on, water, electric)
  values (v_room, 'move_out', date_trunc('month', p_date)::date, p_date, p_water, p_electric);

  update public.contracts
     set status = 'ended', moved_out_on = p_date,
         deposit_returned = p_deposit_returned, move_out_note = coalesce(p_note, '')
   where id = p_contract_id;

  if v_status = 'vacant' then
    v_status := public.natural_room_status(v_room);   -- contract is ended now, so never 'occupied'
  end if;
  update public.rooms set status = v_status where id = v_room;

  update public.tenants
     set line_user_id = null, line_display_name = '', line_linked_at = null
   where id = v_tenant;
end;
$$;

-- ================================================================ daily expiry
-- Pending / confirmed reservations whose expires_on has passed (Bangkok date) become 'expired';
-- the trigger frees their rooms. Called by pg_cron (below); returns how many expired.
create function public.expire_reservations()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.reservations
     set status = 'expired'
   where status in ('pending', 'confirmed')
     and expires_on < (now() at time zone 'Asia/Bangkok')::date;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ================================================================ RLS + grants
alter table public.reservations        enable row level security;
alter table public.maintenance_tickets enable row level security;

revoke all on public.reservations, public.maintenance_tickets from anon;
grant select, insert, update, delete on public.reservations, public.maintenance_tickets to authenticated;
grant all on public.reservations, public.maintenance_tickets to service_role;
grant usage on sequence public.booking_receipt_seq to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['reservations', 'maintenance_tickets']
  loop
    execute format('create policy "%1$s: members read" on public.%1$I for select to authenticated using ((select public.is_member()))', t);
    execute format('create policy "%1$s: members add" on public.%1$I for insert to authenticated with check ((select public.is_member()))', t);
    execute format('create policy "%1$s: members edit" on public.%1$I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
    execute format('create policy "%1$s: admin deletes" on public.%1$I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end;
$$;

revoke execute on function
  public.natural_room_status(uuid),
  public.assert_room_reservable(uuid, date, uuid),
  public.expire_reservations(),
  public.reservations_before(), public.reservations_after(),
  public.maintenance_before(), public.maintenance_after()
from public, anon;
grant execute on function public.natural_room_status(uuid), public.assert_room_reservable(uuid, date, uuid) to authenticated, service_role;
grant execute on function public.expire_reservations() to service_role;

revoke execute on function
  public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric, numeric, integer, uuid)
from public, anon;
grant execute on function
  public.move_in(uuid, uuid, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric, numeric, integer, uuid)
to authenticated;

-- ================================================================ storage: ticket photos (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maintenance', 'maintenance', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "maintenance photos: members read" on storage.objects
  for select to authenticated using (bucket_id = 'maintenance' and (select public.is_member()));
create policy "maintenance photos: members upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'maintenance' and (select public.is_member()));
create policy "maintenance photos: admin deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'maintenance' and (select public.is_admin()));

-- ================================================================ schedule the daily expiry
-- 17:05 UTC = 00:05 Bangkok. Pure SQL, no secret needed.
-- To stop it: select cron.unschedule('reservations-expire');
create extension if not exists pg_cron;
select cron.schedule('reservations-expire', '5 17 * * *', $job$ select public.expire_reservations(); $job$);
