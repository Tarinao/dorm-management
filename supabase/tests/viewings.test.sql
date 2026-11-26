-- Database tests for viewings (migration 20261126193657). One transaction, ROLLED BACK.
-- Run after the migration is applied. Any failure stops with "TEST FAILED: ...".

begin;

create function pg_temp.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'TEST FAILED: %', p_what; end if;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c001', 'test-admin@example.invalid'),
  ('00000000-0000-4000-8000-00000000c002', 'test-staff@example.invalid');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000c001';
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-00000000c002';

-- what the webhook (service role) writes for "Book a viewing"
insert into public.viewings (guest_name, phone, line_user_id, visit_date, time_of_day, source)
values ('Test Guest', '0812345678', 'U' || repeat('c', 32), current_date + 3, 'afternoon', 'line');

-- the bot's new step is allowed in line_users
insert into public.line_users (line_user_id, menu_state, draft) values ('U' || repeat('c', 32), 'book_time', '{"name":"x"}');

do $$
begin
  insert into public.viewings (guest_name, visit_date, time_of_day) values ('Bad', current_date, 'night');
  perform pg_temp.check(false, 'unknown time of day must be rejected');
exception when check_violation then null;
end;
$$;

-- ---------------------------------------------------------------- staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v uuid; n int; rooms_before text;
begin
  select string_agg(id::text || status, ',' order by id) into rooms_before from public.rooms;

  perform pg_temp.check((select count(*) from public.viewings where guest_name = 'Test Guest') = 1, 'staff read viewings');
  insert into public.viewings (guest_name, phone, visit_date, visit_time, room_id)
  values ('Walk-in', '021234567', current_date, '14:30', (select id from public.rooms order by number limit 1))
  returning id into v;
  perform pg_temp.check((select status = 'requested' and source = 'staff' and time_of_day = 'any' from public.viewings where id = v),
                        'defaults: requested, staff, any time');
  update public.viewings set status = 'confirmed' where id = v;
  update public.viewings set status = 'viewed' where id = v;
  perform pg_temp.check((select status from public.viewings where id = v) = 'viewed', 'staff change status');

  -- a viewing never changes a room or makes a reservation
  perform pg_temp.check((select string_agg(id::text || status, ',' order by id) from public.rooms) = rooms_before, 'rooms untouched by viewings');
  perform pg_temp.check((select count(*) from public.reservations where guest_name in ('Walk-in', 'Test Guest')) = 0, 'no reservation made');

  with d as (delete from public.viewings where id = v returning 1) select count(*) into n from d;
  perform pg_temp.check(n = 0, 'staff cannot delete a viewing');
end;
$$;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', true);
do $$
declare n int;
begin
  with d as (delete from public.viewings where guest_name = 'Walk-in' returning 1) select count(*) into n from d;
  perform pg_temp.check(n = 1, 'admin deletes a viewing');
end;
$$;

-- ---------------------------------------------------------------- nobody logged in
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
begin
  perform 1 from public.viewings;
  perform pg_temp.check(false, 'anon must not read viewings');
exception
  when insufficient_privilege then null;
end;
$$;

rollback;
