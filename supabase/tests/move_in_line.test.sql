-- Database tests for "move-in carries the LINE account over" (migration 20261127071400).
-- One transaction, ROLLED BACK at the end: nothing is kept. Run after the migration is applied.
-- Any failure stops with "TEST FAILED: ...". Uses made-up rooms T951..T955 and LINE ids.

begin;

create function pg_temp.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'TEST FAILED: %', p_what; end if;
end;
$$;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000d002', 'test-staff@example.invalid');
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-00000000d002';

-- LINE accounts the bot has seen (written by the webhook with the service role)
insert into public.line_users (line_user_id, display_name) values
  ('U' || repeat('a', 32), 'Guest A'),
  ('U' || repeat('b', 32), 'Current B'),
  ('U' || repeat('c', 32), 'Former C');

insert into public.rooms (number, default_rent) values ('T951', 4000), ('T952', 4000), ('T953', 4000), ('T954', 4000), ('T955', 4000);

-- ---------------------------------------------------------------- act as staff (RLS applies)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  r uuid; c uuid; t uuid; x uuid; old uuid;
  room1 uuid := (select id from public.rooms where number = 'T951');
  room2 uuid := (select id from public.rooms where number = 'T952');
  room3 uuid := (select id from public.rooms where number = 'T953');
  room4 uuid := (select id from public.rooms where number = 'T954');
  room5 uuid := (select id from public.rooms where number = 'T955');
begin
  -- 1. reservation from LINE -> the new tenant is linked, with the LINE name
  insert into public.reservations (room_id, guest_name, desired_move_in, status, line_user_id, source)
  values (room1, 'Guest A', current_date, 'confirmed', 'U' || repeat('a', 32), 'line') returning id into r;
  c := public.move_in(room1, null, 'Guest A Full', '', '', '', '', current_date, null, 4000, 0, null, 10, 150, 1, r);
  select tenant_id into t from public.contracts where id = c;
  perform pg_temp.check((select line_user_id = 'U' || repeat('a', 32) and line_display_name = 'Guest A' and line_linked_at is not null
                           from public.tenants where id = t), 'LINE account carried over with its name');
  perform pg_temp.check((select status = 'moved_in' and tenant_id = t from public.reservations where id = r), 'reservation moved in as before');

  -- 2. the LINE account belongs to a CURRENT tenant -> link stays there, new tenant not linked
  x := public.move_in(room2, null, 'Current B', '', '', '', '', current_date, null, 4000, 0, null, 10, 150, 1);
  update public.tenants set line_user_id = 'U' || repeat('b', 32), line_display_name = 'Current B', line_linked_at = now()
   where id = (select tenant_id from public.contracts where id = x);
  insert into public.reservations (room_id, guest_name, desired_move_in, status, line_user_id)
  values (room3, 'Second room', current_date, 'confirmed', 'U' || repeat('b', 32)) returning id into r;
  c := public.move_in(room3, null, 'Second room', '', '', '', '', current_date, null, 4000, 0, null, 10, 150, 1, r);
  perform pg_temp.check((select line_user_id is null from public.tenants where id = (select tenant_id from public.contracts where id = c)),
                         'not carried over from a current tenant');
  perform pg_temp.check((select line_user_id = 'U' || repeat('b', 32) from public.tenants where id = (select tenant_id from public.contracts where id = x)),
                         'current tenant keeps their LINE link');

  -- 3. a FORMER tenant (no active contract) still holds it -> moved to the new tenant
  insert into public.tenants (full_name, line_user_id, line_display_name, line_linked_at)
  values ('Former C', 'U' || repeat('c', 32), 'Former C', now()) returning id into old;
  insert into public.reservations (room_id, guest_name, desired_move_in, status, line_user_id)
  values (room4, 'Back again', current_date, 'pending', 'U' || repeat('c', 32)) returning id into r;
  c := public.move_in(room4, null, 'Back again', '', '', '', '', current_date, null, 4000, 0, null, 10, 150, 1, r);
  perform pg_temp.check((select line_user_id = 'U' || repeat('c', 32) from public.tenants where id = (select tenant_id from public.contracts where id = c)),
                         'link moved from a former tenant');
  perform pg_temp.check((select line_user_id is null and line_display_name = '' and line_linked_at is null from public.tenants where id = old),
                         'former tenant unlinked');

  -- 4. reservation without LINE, and a walk-in -> nothing linked (as before)
  insert into public.reservations (room_id, guest_name, desired_move_in, status)
  values (room5, 'Phone booking', current_date, 'confirmed') returning id into r;
  c := public.move_in(room5, null, 'Phone booking', '', '', '', '', current_date, null, 4000, 0, null, 10, 150, 1, r);
  perform pg_temp.check((select line_user_id is null from public.tenants where id = (select tenant_id from public.contracts where id = c)),
                         'no LINE on the reservation -> no link');
end;
$$;

rollback;
