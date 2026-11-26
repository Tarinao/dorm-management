-- Database tests for reservations + maintenance (migration 20261126101653).
-- Everything runs in ONE transaction that is ROLLED BACK at the end: nothing is kept.
-- Run it in the SQL editor (or psql) AFTER the migration is applied. Any failure stops with
-- "TEST FAILED: ...". Success ends with the notice "reservations/maintenance tests: all passed".
--
-- Uses two made-up logins (admin + staff) and rooms T901..T905, all removed by the rollback.

begin;

-- ---------------------------------------------------------------- helpers (temporary)
create function pg_temp.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
declare
  v_failed boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_failed := true;
    if sqlerrm !~ p_pattern then
      raise exception 'TEST FAILED: % -> wrong error: %', p_sql, sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'TEST FAILED: expected an error matching "%" from: %', p_pattern, p_sql;
  end if;
end;
$$;

create function pg_temp.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'TEST FAILED: %', p_what;
  end if;
end;
$$;

create function pg_temp.room_status(p_number text) returns text
language sql as $$ select status from public.rooms where number = p_number $$;

-- ---------------------------------------------------------------- two test logins
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'test-admin@example.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'test-staff@example.invalid');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000a001';
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-00000000a002';

-- ---------------------------------------------------------------- act as the admin (RLS applies)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);
set local role authenticated;

insert into public.rooms (number, default_rent) values ('T901', 4000), ('T902', 4500), ('T903', 5000), ('T904', 5000), ('T905', 3500);

-- T903: occupied until 2027-01-31.  T904: occupied, no end date.
select public.move_in((select id from public.rooms where number = 'T903'), null, 'Tenant Three', '', '', '', '',
                      '2026-06-01', '2027-01-31', 5000, 5000, null, 100, 150, 1);
select public.move_in((select id from public.rooms where number = 'T904'), null, 'Tenant Four', '', '', '', '',
                      '2026-06-01', null, 5000, 5000, null, 100, 150, 1);

do $$
declare
  t901 uuid := (select id from public.rooms where number = 'T901');
  t902 uuid := (select id from public.rooms where number = 'T902');
  t903 uuid := (select id from public.rooms where number = 'T903');
  t904 uuid := (select id from public.rooms where number = 'T904');
  t905 uuid := (select id from public.rooms where number = 'T905');
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; tk uuid; c uuid;
  v record;
begin
  -- ===== 1. double booking
  insert into public.reservations (room_id, guest_name, desired_move_in) values (t901, 'Guest One', '2026-12-10') returning id into r1;
  perform pg_temp.check((select expires_on from public.reservations where id = r1) = date '2026-12-17', 'expires_on defaults to move-in + 7');
  perform pg_temp.expect_error(format($q$insert into public.reservations (room_id, guest_name, desired_move_in) values (%L, 'Guest Two', '2026-12-20')$q$, t901),
                               'ROOM_ALREADY_RESERVED|reservations_one_active_per_room');

  -- ===== 2. confirm -> reserved; a second booking still refused; cancel -> vacant, then free to book
  update public.reservations set status = 'confirmed' where id = r1;
  perform pg_temp.check(pg_temp.room_status('T901') = 'reserved', 'confirming sets a vacant room to reserved');
  perform pg_temp.expect_error(format($q$insert into public.reservations (room_id, guest_name, desired_move_in) values (%L, 'Guest Two', '2026-12-20')$q$, t901),
                               'ROOM_ALREADY_RESERVED|reservations_one_active_per_room');
  perform pg_temp.expect_error(format($q$update public.reservations set status = 'pending' where id = %L$q$, r1), 'BAD_RESERVATION_STATUS');
  update public.reservations set status = 'cancelled' where id = r1;
  perform pg_temp.check(pg_temp.room_status('T901') = 'vacant', 'cancelling puts the room back to vacant');
  perform pg_temp.expect_error(format($q$update public.reservations set status = 'confirmed' where id = %L$q$, r1), 'RESERVATION_CLOSED');
  insert into public.reservations (room_id, guest_name, desired_move_in, status) values (t901, 'Guest Two', '2026-12-20', 'confirmed') returning id into r2;
  perform pg_temp.check(pg_temp.room_status('T901') = 'reserved', 'new confirmed booking after the cancelled one');

  -- someone else cannot move into a room reserved for Guest Two
  perform pg_temp.expect_error(format($q$select public.move_in(%L, null, 'Walk In', '', '', '', '', '2026-12-01', null, 4000, 0, null, 1, 150, 1)$q$, t901),
                               'ROOM_RESERVED_FOR_OTHER');

  -- ===== 3. occupied rooms: only with a known move-out date, and not before it
  perform pg_temp.expect_error(format($q$insert into public.reservations (room_id, guest_name, desired_move_in) values (%L, 'G', '2027-03-01')$q$, t904),
                               'ROOM_NO_MOVE_OUT_DATE');
  perform pg_temp.expect_error(format($q$insert into public.reservations (room_id, guest_name, desired_move_in) values (%L, 'G', '2027-01-15')$q$, t903),
                               'MOVE_IN_BEFORE_MOVE_OUT');
  insert into public.reservations (room_id, guest_name, desired_move_in, status) values (t903, 'Next Tenant', '2027-02-01', 'confirmed') returning id into r3;
  perform pg_temp.check(pg_temp.room_status('T903') = 'occupied', 'an occupied room stays occupied when booked');
  select id into c from public.contracts where room_id = t903 and status = 'active';
  perform public.move_out(c, '2027-01-31', null, 200, 5000, '', 'vacant');
  perform pg_temp.check(pg_temp.room_status('T903') = 'reserved', 'move-out of a booked room makes it reserved, not vacant');

  -- ===== 4. maintenance block on a vacant room
  insert into public.maintenance_tickets (room_id, title, block_room, priority) values (t902, 'Leaking pipe', true, 'urgent') returning id into tk;
  perform pg_temp.check(pg_temp.room_status('T902') = 'maintenance', 'a blocking ticket sets a vacant room to maintenance');
  perform pg_temp.expect_error(format($q$insert into public.reservations (room_id, guest_name, desired_move_in) values (%L, 'G', '2026-12-15')$q$, t902),
                               'ROOM_IN_MAINTENANCE');
  perform pg_temp.expect_error(format($q$select public.move_in(%L, null, 'G', '', '', '', '', '2026-12-01', null, 4500, 0, null, 1, 150, 1)$q$, t902),
                               'ROOM_IN_MAINTENANCE');
  update public.maintenance_tickets set status = 'in_progress' where id = tk;
  perform pg_temp.check(pg_temp.room_status('T902') = 'maintenance', 'still blocked while in progress');
  update public.maintenance_tickets set status = 'done', cost = 850 where id = tk;
  perform pg_temp.check(pg_temp.room_status('T902') = 'vacant', 'closing the ticket frees the room');
  perform pg_temp.check((select closed_at is not null from public.maintenance_tickets where id = tk), 'closed_at set');
  update public.maintenance_tickets set status = 'open' where id = tk;
  perform pg_temp.check(pg_temp.room_status('T902') = 'maintenance' and (select closed_at is null from public.maintenance_tickets where id = tk), 'reopening blocks again');
  update public.maintenance_tickets set block_room = false where id = tk;
  perform pg_temp.check(pg_temp.room_status('T902') = 'vacant', 'turning the block off frees the room');
  update public.maintenance_tickets set status = 'cancelled' where id = tk;
  perform pg_temp.expect_error(format($q$update public.maintenance_tickets set room_id = %L where id = %L$q$, t901, tk), 'TICKET_ROOM_FIXED');

  -- a blocking ticket on an OCCUPIED room keeps it occupied
  insert into public.maintenance_tickets (room_id, title, block_room) values (t904, 'AC noisy', true);
  perform pg_temp.check(pg_temp.room_status('T904') = 'occupied', 'occupied rooms keep their status');

  -- ===== 5. booking fee receipt + convert to move-in credits the fee
  insert into public.reservations (room_id, guest_name, phone, desired_move_in, booking_fee, booking_fee_paid_on, booking_fee_method, status)
  values (t902, 'Fee Guest', '0812345678', '2026-12-05', 2000, '2026-11-26', 'transfer', 'confirmed') returning id into r4;
  perform pg_temp.check((select booking_receipt_no ~ '^B-[0-9]{6}$' from public.reservations where id = r4), 'booking receipt number B-000001');
  c := public.move_in(t902, null, 'Fee Guest', '0812345678', '', '', '', '2026-12-05', null, 4500, 6000, null, 300, 150, 1, r4);
  select status, contract_id, tenant_id into v from public.reservations where id = r4;
  perform pg_temp.check(v.status = 'moved_in' and v.contract_id = c and v.tenant_id is not null, 'reservation marked moved_in with contract and tenant');
  perform pg_temp.check((select booking_fee_credit from public.contracts where id = c) = 2000, 'booking fee credited to the deposit');
  perform pg_temp.check(pg_temp.room_status('T902') = 'occupied', 'room occupied after convert');
  perform pg_temp.expect_error(format($q$select public.move_in(%L, null, 'X', '', '', '', '', '2026-12-05', null, 4000, 0, null, 1, 150, 1, %L)$q$, t905, r2),
                               'RESERVATION_OTHER_ROOM');

  -- ===== 6. LINE requests have no room and never block a room
  insert into public.reservations (guest_name, phone, desired_move_in, source) values ('Line Guest', '0899999999', '2026-12-12', 'line') returning id into r5;
  perform pg_temp.expect_error(format($q$update public.reservations set status = 'confirmed' where id = %L$q$, r5), 'reservations_check|check constraint');
  update public.reservations set room_id = t905 where id = r5;
  update public.reservations set status = 'confirmed' where id = r5;
  perform pg_temp.check(pg_temp.room_status('T905') = 'reserved', 'LINE request confirmed after a room was chosen');
end;
$$;

-- ---------------------------------------------------------------- staff: cannot delete
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a002","role":"authenticated"}', true);
do $$
declare n int;
begin
  with d as (delete from public.reservations where guest_name = 'Guest Two' returning 1) select count(*) into n from d;
  perform pg_temp.check(n = 0, 'staff cannot delete reservations');
  with d as (delete from public.maintenance_tickets where title = 'AC noisy' returning 1) select count(*) into n from d;
  perform pg_temp.check(n = 0, 'staff cannot delete tickets');
  -- staff CAN create and confirm
  update public.reservations set note = 'called' where guest_name = 'Guest Two';
  perform pg_temp.check((select note from public.reservations where guest_name = 'Guest Two') = 'called', 'staff can edit');
end;
$$;

-- ---------------------------------------------------------------- daily expiry (runs as the cron job does)
reset role;
update public.reservations set expires_on = current_date - 1 where guest_name = 'Line Guest';
update public.reservations set expires_on = current_date + 30 where guest_name = 'Guest Two';
select public.expire_reservations();
do $$
begin
  perform pg_temp.check((select status from public.reservations where guest_name = 'Line Guest') = 'expired', 'past expires_on -> expired');
  perform pg_temp.check(pg_temp.room_status('T905') = 'vacant', 'expiry frees the room');
  perform pg_temp.check((select status from public.reservations where guest_name = 'Guest Two') = 'confirmed', 'future bookings are not expired');
  raise notice 'reservations/maintenance tests: all passed';
end;
$$;

rollback;
