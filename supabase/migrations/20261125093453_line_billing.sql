-- 0010: bills on LINE (phase 2).
--   bills          : when the bill / last reminder was sent on LINE, and the payment method the
--                    tenant tapped (so next month their choice is shown first).
--   settings       : the LINE account that gets the monthly summary (chosen by the owner).
--   bill_summary   : same view, plus the new bill columns at the end.
--   payment_slips  : slip photos sent in the LINE chat. slip_ref is UNIQUE: the first slip with a
--                    given QR reference holds it; the same slip sent again is stored with
--                    slip_ref null and duplicate_of pointing at the first one ("Duplicate slip").
--                    A slip never marks a bill paid: staff confirm it (confirm_slip) or reject it.
--   line_send_runs : the summary of each "send bills" / reminders run.
--   generate_bills : may also be called by the service role (the monthly-bills Edge Function,
--                    which checks the cron secret or a member's login itself).
--   storage        : private buckets "slips" (members read) and "promptpay-qr" (service role only).
-- Non-destructive: only adds columns, tables, policies and buckets.

-- ---------------------------------------------------------------- bills
alter table public.bills
  add column line_sent_at         timestamptz,
  add column line_reminded_at     timestamptz,
  add column pay_method_chosen    text check (pay_method_chosen in ('promptpay', 'transfer', 'cash')),
  add column pay_method_chosen_at timestamptz;

-- ---------------------------------------------------------------- settings
alter table public.settings
  add column summary_line_user_id text check (summary_line_user_id ~ '^U[0-9a-f]{32}$');

-- ---------------------------------------------------------------- bill_summary (+ LINE columns at the end)
create or replace view public.bill_summary
with (security_invoker = true)
as
select
  b.id,
  b.room_id,
  r.number                                             as room_number,
  b.contract_id,
  b.month,
  b.rent,
  b.water_prev, b.water_curr, b.water_units, b.water_people, b.water_per_person, b.water_amount,
  b.elec_prev,  b.elec_curr,  b.elec_units,  b.elec_rate,  b.elec_amount,
  b.due_date,
  b.note,
  b.created_at,
  coalesce(x.extras_total, 0)                                                  as extras_total,
  b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0)        as total,
  coalesce(p.paid, 0)                                                          as paid,
  b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0)
    - coalesce(p.paid, 0)                                                      as balance,
  case
    when b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0) - coalesce(p.paid, 0) <= 0 then 'paid'
    when coalesce(p.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end                                                                          as status,
  (b.rent + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0) - coalesce(p.paid, 0) > 0
    and b.due_date < (now() at time zone 'Asia/Bangkok')::date)                as is_overdue,
  p.last_paid_on,
  b.line_sent_at,
  b.line_reminded_at,
  b.pay_method_chosen
from public.bills b
join public.rooms r on r.id = b.room_id
left join lateral (
  select sum(e.amount) as extras_total from public.bill_extras e where e.bill_id = b.id
) x on true
left join lateral (
  select sum(pm.amount) as paid, max(pm.paid_on) as last_paid_on from public.payments pm where pm.bill_id = b.id
) p on true;

-- ---------------------------------------------------------------- payment slips
create table public.payment_slips (
  id              uuid primary key default gen_random_uuid(),
  line_message_id text not null unique,                       -- LINE re-delivering the same event adds nothing
  line_user_id    text not null check (line_user_id ~ '^U[0-9a-f]{32}$'),
  tenant_id       uuid references public.tenants (id) on delete set null,
  bill_id         uuid references public.bills (id) on delete set null,   -- the open bill it is probably for
  storage_path    text not null,                              -- in the private "slips" bucket
  qr_text         text,                                       -- what the slip's QR says; null = no QR found
  qr_ref          text,                                       -- the reference read from it (every slip)
  slip_ref        text unique,                                -- the same, but only on the FIRST slip with it
  duplicate_of    uuid references public.payment_slips (id) on delete set null,
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  payment_id      uuid references public.payments (id) on delete set null,
  received_at     timestamptz not null default now(),
  checked_by      uuid references auth.users (id) on delete set null,
  checked_at      timestamptz,
  check ((status = 'pending') = (checked_at is null)),
  check (slip_ref is null or slip_ref = qr_ref),
  check (duplicate_of is null or slip_ref is null)
);
create index payment_slips_status_idx on public.payment_slips (status, received_at desc);
create index payment_slips_bill_idx on public.payment_slips (bill_id);
create index payment_slips_qr_ref_idx on public.payment_slips (qr_ref);

alter table public.payment_slips enable row level security;
revoke all on public.payment_slips from anon;
grant select, update, delete on public.payment_slips to authenticated;
grant all on public.payment_slips to service_role;

create policy "payment_slips: members read" on public.payment_slips
  for select to authenticated using ((select public.is_member()));
create policy "payment_slips: members edit" on public.payment_slips
  for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "payment_slips: admin deletes" on public.payment_slips
  for delete to authenticated using ((select public.is_admin()));
-- No insert policy: slips only come in through the line-webhook Edge Function (service role).

-- Staff checked the slip against the bank: record the payment and close the slip, in one step.
create function public.confirm_slip(p_slip_id uuid, p_amount numeric, p_paid_on date, p_note text default '')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slip record;
  v_pay  uuid;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select id, status, bill_id into v_slip from public.payment_slips where id = p_slip_id for update;
  if not found or v_slip.status <> 'pending' then
    raise exception 'SLIP_NOT_PENDING';
  end if;
  if v_slip.bill_id is null then
    raise exception 'SLIP_HAS_NO_BILL';
  end if;
  insert into public.payments (bill_id, amount, paid_on, method, note)
  values (v_slip.bill_id, p_amount, p_paid_on, 'transfer', coalesce(btrim(p_note), ''))
  returning id into v_pay;
  update public.payment_slips
     set status = 'confirmed', payment_id = v_pay, checked_by = auth.uid(), checked_at = now()
   where id = p_slip_id;
  return v_pay;
end;
$$;
revoke execute on function public.confirm_slip(uuid, numeric, date, text) from public, anon;
grant execute on function public.confirm_slip(uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------- send runs (summaries)
create table public.line_send_runs (
  id       uuid primary key default gen_random_uuid(),
  kind     text not null check (kind in ('monthly', 'manual', 'reminders')),
  month    date,
  ran_at   timestamptz not null default now(),
  ran_by   uuid references auth.users (id) on delete set null,   -- null = the scheduled job
  summary  jsonb not null default '{}'::jsonb
);
create index line_send_runs_ran_at_idx on public.line_send_runs (ran_at desc);

alter table public.line_send_runs enable row level security;
revoke all on public.line_send_runs from anon;
grant select, delete on public.line_send_runs to authenticated;
grant all on public.line_send_runs to service_role;

create policy "line_send_runs: members read" on public.line_send_runs
  for select to authenticated using ((select public.is_member()));
create policy "line_send_runs: admin deletes" on public.line_send_runs
  for delete to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------- generate_bills: also for the service role
-- Same as 0007, except who may call it.
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
  -- Nested so the service role never calls is_member() (which only logged-in users may execute).
  if current_user <> 'service_role' then
    if not public.is_member() then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
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
grant execute on function public.generate_bills(date) to service_role;

-- ---------------------------------------------------------------- storage buckets (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 10485760, array['image/jpeg', 'image/png']),
       ('promptpay-qr', 'promptpay-qr', false, 1048576, array['image/png'])
on conflict (id) do nothing;

-- Slips: members can view them (signed URLs in the app); only the webhook (service role) uploads.
create policy "slips: members read" on storage.objects
  for select to authenticated using (bucket_id = 'slips' and (select public.is_member()));
create policy "slips: admin deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'slips' and (select public.is_admin()));
-- promptpay-qr: no policies, so only the service role (which bypasses RLS) can use it.
