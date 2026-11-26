-- Database tests for the LINE bot tables (migration 20261126101711). One transaction, ROLLED BACK.
-- Run after the migration is applied. Any failure stops with "TEST FAILED: ...".

begin;

create function pg_temp.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'TEST FAILED: %', p_what; end if;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000b001', 'test-admin@example.invalid'),
  ('00000000-0000-4000-8000-00000000b002', 'test-staff@example.invalid');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-00000000b001';
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-00000000b002';

-- what the webhook (service role) writes
insert into public.line_users (line_user_id, display_name, lang, handover_until, wants_talk_at)
values ('U' || repeat('b', 32), 'Test Guest', 'th', now() + interval '12 hours', now());

-- ---------------------------------------------------------------- staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  perform pg_temp.check((select count(*) from public.line_users) >= 1, 'staff can read line_users');
  perform pg_temp.check((select count(*) from public.line_info) = 5, 'five dorm-info rows, readable by staff');

  with u as (update public.line_users set lang = 'en' returning 1) select count(*) into n from u;
  perform pg_temp.check(false, 'staff must not update line_users directly');
exception
  when insufficient_privilege then null;   -- expected: no update grant
end;
$$;
do $$
declare n int;
begin
  with u as (update public.line_info set text_th = 'x' returning 1) select count(*) into n from u;
  perform pg_temp.check(n = 0, 'staff cannot edit dorm info (admin only)');
  perform public.line_chat_done('U' || repeat('b', 32), false);
  perform pg_temp.check((select wants_talk_at is null and handover_until is not null from public.line_users where line_user_id = 'U' || repeat('b', 32)),
                        'Done clears "wants to talk", keeps the handover');
  perform public.line_chat_done('U' || repeat('b', 32), true);
  perform pg_temp.check((select handover_until is null from public.line_users where line_user_id = 'U' || repeat('b', 32)),
                        '"let the bot answer again" ends the handover');
end;
$$;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b001","role":"authenticated"}', true);
do $$
declare n int;
begin
  with u as (update public.line_info set text_th = 'ห้องพัดลม', text_en = 'Fan room' where key = 'room_types' returning 1) select count(*) into n from u;
  perform pg_temp.check(n = 1, 'admin edits dorm info');
  update public.settings set office_phone = '021234567', location_lat = 13.7563, location_lng = 100.5018 where id = 1;
  perform pg_temp.check((select location_lat from public.settings) = 13.7563, 'map pin saved');
end;
$$;

-- ---------------------------------------------------------------- nobody logged in
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
begin
  perform 1 from public.line_users;
  perform pg_temp.check(false, 'anon must not read line_users');
exception
  when insufficient_privilege then null;
end;
$$;

rollback;
