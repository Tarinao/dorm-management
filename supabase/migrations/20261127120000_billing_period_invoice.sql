-- Billing period, common fee (ส่วนกลาง) and invoices.
--
-- 1. Billing period. The bill made on the 1st of month M (bills.month = M) has
--      rent + common fee for M (in advance)          -> bills.rent_month  = M
--      electric + water for M-1 (M-1 meter readings) -> bills.usage_month = M-1
--    A contract that starts during M gets a first bill with rent + common fee only (usage_month null).
--    A contract that ended (moved out) during M-1 gets a final bill with usage only, up to the
--    move-out reading (rent_month null, rent 0, common fee 0).
--    Per contract and month, so a room changing tenants can have the old tenant's final bill and
--    the new tenant's bill in the same month: unique (contract_id, month) instead of (room_id, month).
--    Due date: settings.due_day of M itself (was: of the month after).
-- 2. Common fee: settings.common_fee (default 300, admin-only like every setting) is copied onto
--    each new bill (bills.common_fee), so changing it later never changes an old bill. It is part
--    of the total everywhere: bill_summary (total, balance, status, is_overdue) and the payment guard.
-- 3. Invoices: bills.invoice_no "INV" + YYYYMM (bill month) + 6-digit running number, set once on
--    insert from a sequence (never reused, never changed); bills.issued_by_name (who generated it).
--    settings: Thai/English name, address, tax id, email, LINE OA id, invoice note, logo.
--    tenants.address. Storage bucket "branding" (private) for the logo.
--    invoice_links: one token per bill for the read-only LINE link (stored as a SHA-256 hash,
--    expires after 90 days). Only the service role (Edge Functions) can read or write it.
--
-- Bills already in the table keep their amounts: common_fee defaults to 0 for them, and their
-- rent_month / usage_month are set to their own month (the old rule: rent and usage of one month).

-- ---------------------------------------------------------------- settings
alter table public.settings
  add column common_fee    numeric(10,2) not null default 300 check (common_fee >= 0),
  add column dorm_name_en  text not null default '' check (length(dorm_name_en) <= 200),
  add column address       text not null default '' check (length(address) <= 500),
  add column tax_id        text not null default '' check (length(tax_id) <= 40),
  add column email         text not null default '' check (length(email) <= 200),
  add column line_oa_id    text not null default '' check (length(line_oa_id) <= 60),
  add column invoice_note  text not null default '' check (length(invoice_note) <= 1000),
  add column logo_path     text check (logo_path is null or logo_path ~ '^logo/[A-Za-z0-9._-]+$');

-- ---------------------------------------------------------------- tenants
alter table public.tenants
  add column address text not null default '' check (length(address) <= 500);

-- ---------------------------------------------------------------- bills
alter table public.bills
  add column rent_month     date check (rent_month is null or extract(day from rent_month) = 1),
  add column usage_month    date check (usage_month is null or extract(day from usage_month) = 1),
  add column common_fee     numeric(10,2) not null default 0 check (common_fee >= 0),
  add column invoice_no     text,
  add column issued_by_name text not null default '';

update public.bills set rent_month = month, usage_month = month;

create sequence public.invoice_no_seq;
grant usage on sequence public.invoice_no_seq to authenticated, service_role;

-- Numbers for bills that already exist, oldest first.
with numbered as (
  select id, month, row_number() over (order by created_at, id) as n from public.bills
)
update public.bills b
   set invoice_no = 'INV' || to_char(numbered.month, 'YYYYMM') || lpad(nextval('public.invoice_no_seq')::text, 6, '0')
  from numbered
 where numbered.id = b.id;

alter table public.bills alter column invoice_no set not null;
alter table public.bills add constraint bills_invoice_no_key unique (invoice_no);

-- One bill per contract and month (imported history has no contract: one per room and month).
alter table public.bills drop constraint bills_room_id_month_key;
create unique index bills_one_per_contract_month on public.bills (contract_id, month) where contract_id is not null;
create unique index bills_one_per_room_month_imported on public.bills (room_id, month) where contract_id is null;

-- Invoice number and issuer: set on insert, never changed afterwards.
create function public.bills_invoice_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_n bigint;
begin
  if tg_op = 'INSERT' then
    v_n := nextval('public.invoice_no_seq');
    new.invoice_no := 'INV' || to_char(new.month, 'YYYYMM') || lpad(v_n::text, greatest(6, length(v_n::text)), '0');
    if coalesce(new.issued_by_name, '') = '' then
      new.issued_by_name := coalesce((select p.full_name from public.profiles p where p.id = auth.uid()), '');
    end if;
  else
    new.invoice_no := old.invoice_no;
    new.issued_by_name := old.issued_by_name;
  end if;
  return new;
end;
$$;

create trigger bills_invoice_fields
  before insert or update on public.bills
  for each row execute function public.bills_invoice_fields();

-- ---------------------------------------------------------------- bill_summary (+ common fee in the total)
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
  coalesce(x.extras_total, 0)                                                                as extras_total,
  b.rent + b.common_fee + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0)      as total,
  coalesce(p.paid, 0)                                                                        as paid,
  b.rent + b.common_fee + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0)
    - coalesce(p.paid, 0)                                                                    as balance,
  case
    when b.rent + b.common_fee + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0) - coalesce(p.paid, 0) <= 0 then 'paid'
    when coalesce(p.paid, 0) > 0 then 'partial'
    else 'unpaid'
  end                                                                                        as status,
  (b.rent + b.common_fee + b.water_amount + b.elec_amount + coalesce(x.extras_total, 0) - coalesce(p.paid, 0) > 0
    and b.due_date < (now() at time zone 'Asia/Bangkok')::date)                              as is_overdue,
  p.last_paid_on,
  b.line_sent_at,
  b.line_reminded_at,
  b.pay_method_chosen,
  b.common_fee,
  b.rent_month,
  b.usage_month,
  b.invoice_no,
  b.issued_by_name
from public.bills b
join public.rooms r on r.id = b.room_id
left join lateral (
  select sum(e.amount) as extras_total from public.bill_extras e where e.bill_id = b.id
) x on true
left join lateral (
  select sum(pm.amount) as paid, max(pm.paid_on) as last_paid_on from public.payments pm where pm.bill_id = b.id
) p on true;

-- ---------------------------------------------------------------- payment guard (+ common fee)
create or replace function public.check_payment_not_over()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_total numeric;
  v_paid  numeric;
begin
  -- lock the bill so two people paying at the same moment are checked one after the other
  perform 1 from public.bills where id = new.bill_id for update;

  select b.rent + b.common_fee + b.water_amount + b.elec_amount
         + coalesce((select sum(e.amount) from public.bill_extras e where e.bill_id = b.id), 0)
    into v_total
    from public.bills b
   where b.id = new.bill_id;

  select coalesce(sum(amount), 0) into v_paid
    from public.payments
   where bill_id = new.bill_id and id <> new.id;

  if v_paid + new.amount > v_total then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: balance is %', v_total - v_paid using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- generate_bills: new billing period
-- Mirrored in src/lib/billing.ts (on-screen preview, unit tests). For bill month M and each contract:
--   rent + common fee  when the contract lives in M:        start <= end of M and (no move-out or move-out > 1st of M)
--   usage of M-1       when it lived in M-1 before M began:  start < 1st of M and (no move-out or move-out > 1st of M-1)
--   current reading    = the move-out reading when the contract moved out by the 1st of M (final bill),
--                        else the room's monthly reading for M-1
--   previous reading   = the latest reading before it (order: date, then move_out < move_in < monthly)
-- Return values as before: room_number, outcome, new_bill_id (one row per contract).
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
            make_date(extract(year from v_month)::int, extract(month from v_month)::int, v_set.due_day))
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

-- ---------------------------------------------------------------- invoice links (LINE "View invoice")
-- The raw token is only ever in the LINE message; the table keeps its SHA-256 (hex).
create table public.invoice_links (
  bill_id     uuid primary key references public.bills (id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '90 days'),
  check (expires_at > created_at)
);
alter table public.invoice_links enable row level security;
revoke all on public.invoice_links from anon, authenticated;
grant all on public.invoice_links to service_role;
-- No policies: nobody but the service role (which bypasses RLS) can see or make links.

-- ---------------------------------------------------------------- logo storage (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Members see the logo (signed URLs in the app); only admins change it. The invoice Edge Function
-- reads it with the service role.
create policy "branding: members read" on storage.objects
  for select to authenticated using (bucket_id = 'branding' and (select public.is_member()));
create policy "branding: admin uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'branding' and (select public.is_admin()));
create policy "branding: admin updates" on storage.objects
  for update to authenticated using (bucket_id = 'branding' and (select public.is_admin()))
  with check (bucket_id = 'branding' and (select public.is_admin()));
create policy "branding: admin deletes" on storage.objects
  for delete to authenticated using (bucket_id = 'branding' and (select public.is_admin()));
