-- Database tests for the billing period, the common fee and invoice numbers
-- (migration 20261127111701_billing_period_invoice).
-- One transaction, ROLLED BACK at the end: nothing is kept. Any failure stops with "TEST FAILED: ...".
-- Uses made-up rooms T961..T963 and two made-up users (admin, staff).

begin;

create function pg_temp.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'TEST FAILED: %', p_what; end if;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e001', 'test-admin@example.invalid'),
  ('00000000-0000-4000-8000-00000000e002', 'test-staff@example.invalid');
update public.profiles set role = 'admin', full_name = 'Admin Test' where id = '00000000-0000-4000-8000-00000000e001';
update public.profiles set role = 'staff', full_name = 'Staff Test' where id = '00000000-0000-4000-8000-00000000e002';
update public.settings set electric_rate = 8, due_day = 5, common_fee = 300 where id = 1;

insert into public.rooms (number, default_rent, water_per_person, occupants) values
  ('T961', 4800, 150, 2), ('T962', 5000, 150, 1), ('T963', 4000, 105, 1);

-- ---------------------------------------------------------------- act as the admin (RLS applies)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  room1 uuid := (select id from public.rooms where number = 'T961');
  room2 uuid := (select id from public.rooms where number = 'T962');
  room3 uuid := (select id from public.rooms where number = 'T963');
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  b record; f record; n int;
begin
  -- room 1: moved in 1 Oct (meter 7000); October and November readings
  c1 := public.move_in(room1, null, 'Tenant One', '0811111111', '', '', '', '2026-10-01', null, 4800, 0, null, 7000, 150, 2);
  perform public.save_monthly_reading(room1, '2026-10-01', '2026-10-31', null, 7071);
  perform public.save_monthly_reading(room1, '2026-11-01', '2026-11-30', null, 7212);

  -- 1. The December bill: December rent + common fee, November electric/water
  select count(*) into n from public.generate_bills('2026-12-01') g where g.outcome = 'created';
  perform pg_temp.check(n = 1, 'one December bill created');
  select * into b from public.bill_summary where contract_id = c1 and month = '2026-12-01';
  perform pg_temp.check(b.rent_month = '2026-12-01' and b.usage_month = '2026-11-01', 'rent month Dec, usage month Nov');
  perform pg_temp.check(b.rent = 4800 and b.common_fee = 300, 'December rent 4800 + common fee 300');
  perform pg_temp.check(b.elec_prev = 7071 and b.elec_curr = 7212 and b.elec_units = 141 and b.elec_amount = 1128,
                        'November electric 7071 -> 7212 = 141 units x 8 = 1128');
  perform pg_temp.check(b.water_people = 2 and b.water_amount = 300, 'water 2 people x 150');
  perform pg_temp.check(b.total = 6528 and b.balance = 6528 and b.status = 'unpaid', 'total 4800 + 300 + 300 + 1128 = 6528');
  perform pg_temp.check(b.due_date = '2026-12-05', 'due on the 5th of December');
  perform pg_temp.check(b.invoice_no ~ '^INV202612[0-9]{6}$', 'invoice number INV + 202612 + 6 digits: ' || b.invoice_no);
  perform pg_temp.check(b.issued_by_name = 'Admin Test', 'issued by the admin who generated it');

  -- running it again makes nothing new
  perform pg_temp.check((select count(*) from public.generate_bills('2026-12-01') g where g.outcome = 'created') = 0, 'second run creates nothing');

  -- 2. A payment can never go above the total that includes the common fee
  begin
    insert into public.payments (bill_id, amount, method) values (b.id, 6528.01, 'cash');
    raise exception 'TEST FAILED: paid more than the total';
  exception when others then
    if sqlerrm not like 'PAYMENT_EXCEEDS_BALANCE%' then raise; end if;
  end;
  insert into public.payments (bill_id, amount, method) values (b.id, 6528, 'cash');
  perform pg_temp.check((select status = 'paid' and balance = 0 from public.bill_summary where id = b.id), 'paying the full total (with common fee) marks it paid');

  -- 3. First bill of a new contract: rent + common fee for the first month, no usage
  c2 := public.move_in(room2, null, 'Tenant Two', '', '', '', '', '2026-12-10', null, 5000, 0, null, 500, 150, 1);
  perform public.generate_bills('2026-12-01');
  select * into f from public.bill_summary where contract_id = c2 and month = '2026-12-01';
  perform pg_temp.check(f.rent = 5000 and f.common_fee = 300 and f.usage_month is null and f.rent_month = '2026-12-01',
                        'first bill: rent + common fee, no usage month');
  perform pg_temp.check(f.water_amount = 0 and f.elec_amount = 0 and f.total = 5300, 'first bill total 5300');

  -- 4. Changing the common fee only affects new bills
  update public.settings set common_fee = 350 where id = 1;
  perform pg_temp.check((select common_fee = 300 and total = 6528 from public.bill_summary where id = b.id), 'old bill keeps common fee 300');

  -- 5. Room 1 changes tenants in December: tenant one leaves 15 Dec (7300), tenant three arrives 20 Dec (7300)
  perform public.move_out(c1, '2026-12-15', null, 7300, 0, '');
  c3 := public.move_in(room1, null, 'Tenant Three', '', '', '', '', '2026-12-20', null, 4800, 0, null, 7300, 150, 2);
  perform public.save_monthly_reading(room1, '2026-12-01', '2026-12-31', null, 7350);
  perform public.save_monthly_reading(room2, '2026-12-01', '2026-12-31', null, 560);

  -- the new tenant's first bill (December) sits next to the old tenant's December bill
  perform public.generate_bills('2026-12-01');
  perform pg_temp.check((select count(*) from public.bills where room_id = room1 and month = '2026-12-01') = 2,
                        'two December bills in room 1 (old tenant, new tenant)');
  perform pg_temp.check((select common_fee = 350 and total = 4800 + 350 from public.bill_summary where contract_id = c3 and month = '2026-12-01'),
                        'a bill made after the change uses the new common fee 350');

  select count(*) into n from public.generate_bills('2027-01-01') g where g.outcome = 'created';
  perform pg_temp.check(n = 3, 'January: final bill (tenant one) + tenant three + tenant two, got ' || n);

  -- final bill: usage only, up to the move-out reading
  select * into f from public.bill_summary where contract_id = c1 and month = '2027-01-01';
  perform pg_temp.check(f.rent_month is null and f.usage_month = '2026-12-01' and f.rent = 0 and f.common_fee = 0,
                        'final bill: no rent, no common fee, usage of December');
  perform pg_temp.check(f.elec_prev = 7212 and f.elec_curr = 7300 and f.elec_amount = 704 and f.water_amount = 300 and f.total = 1004,
                        'final bill: 7212 -> 7300 = 88 units x 8 = 704, water 300, total 1004');
  perform pg_temp.check(f.due_date = '2027-01-05' and f.invoice_no ~ '^INV202701[0-9]{6}$', 'final bill due 5 Jan, numbered INV202701...');

  -- new tenant in room 1: January rent + common fee, December usage from their move-in reading
  select * into f from public.bill_summary where contract_id = c3 and month = '2027-01-01';
  perform pg_temp.check(f.rent = 4800 and f.common_fee = 350 and f.usage_month = '2026-12-01'
                        and f.elec_prev = 7300 and f.elec_curr = 7350 and f.elec_amount = 400 and f.total = 4800 + 350 + 300 + 400,
                        'tenant three: Jan rent + 350 + Dec usage 7300 -> 7350');

  -- tenant two: second bill uses December usage from the move-in reading (500 -> 560)
  select * into f from public.bill_summary where contract_id = c2 and month = '2027-01-01';
  perform pg_temp.check(f.elec_prev = 500 and f.elec_curr = 560 and f.water_amount = 150 and f.total = 5000 + 350 + 150 + 480,
                        'tenant two: Jan rent + 350 + Dec usage 500 -> 560');

  -- February: tenant one has nothing more
  perform public.save_monthly_reading(room1, '2027-01-01', '2027-01-31', null, 7400);
  perform public.save_monthly_reading(room2, '2027-01-01', '2027-01-31', null, 600);
  perform public.generate_bills('2027-02-01');
  perform pg_temp.check(not exists (select 1 from public.bills where contract_id = c1 and month = '2027-02-01'), 'no bill after the final bill');

  -- 6. No monthly reading for the usage month: no bill (rent waits for the meter)
  c4 := public.move_in(room3, null, 'Tenant Four', '', '', '', '', '2026-11-05', null, 4000, 0, null, 100, 105, 1);
  perform pg_temp.check((select g.outcome from public.generate_bills('2026-12-01') g where g.room_number = 'T963') = 'no_reading', 'room 3: no November reading -> no_reading');

  -- 7. Invoice numbers are unique and never change
  perform pg_temp.check((select count(*) = count(distinct invoice_no) from public.bills), 'invoice numbers unique');
  update public.bills set invoice_no = 'INV000000000001', issued_by_name = 'someone else' where id = b.id;
  perform pg_temp.check((select invoice_no ~ '^INV202612' and issued_by_name = 'Admin Test' from public.bills where id = b.id),
                        'invoice number and issuer cannot be changed');

  -- 8. A bill made after its due day is due the day it is made, not overdue at once
  --    (November bill for tenant one, made today, after 5 November: migration 20261127113555)
  perform public.generate_bills('2026-11-01');
  select * into f from public.bill_summary where contract_id = c1 and month = '2026-11-01';
  perform pg_temp.check(f.due_date = greatest('2026-11-05'::date, (now() at time zone 'Asia/Bangkok')::date) and f.is_overdue = false,
                        'bill made after the due day: due the day it is made, not overdue (got ' || f.due_date || ')');

  -- 9. Invoice links are invisible to app users (service role only)
  begin
    perform 1 from public.invoice_links;
    raise exception 'TEST FAILED: app user could read invoice_links';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ---------------------------------------------------------------- staff cannot change the common fee
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  with u as (update public.settings set common_fee = 1 where id = 1 returning 1) select count(*) into n from u;
  perform pg_temp.check(n = 0, 'staff cannot change the common fee');
end;
$$;
reset role;
do $$ begin
  perform pg_temp.check((select common_fee = 350 from public.settings where id = 1), 'common fee still 350');
end $$;

rollback;
