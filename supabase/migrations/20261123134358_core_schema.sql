-- 0002: core tables for the dorm app.
-- Money: numeric(10,2) baht. Meters: numeric(10,1) units. Months: the date of the 1st.

-- ---------------------------------------------------------------- profiles
-- One row per login. role = null means "no access yet"; an admin grants a role.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text not null default '',
  role        text check (role in ('admin', 'staff')),
  created_at  timestamptz not null default now()
);

-- Create a profile automatically whenever someone signs up / is invited.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- settings
-- Exactly one row (id = 1). Rates are copied onto each bill when it is created.
create table public.settings (
  id             smallint primary key default 1 check (id = 1),
  dorm_name      text not null default 'My Dorm',
  water_rate     numeric(10,2) not null default 0 check (water_rate >= 0),
  electric_rate  numeric(10,2) not null default 0 check (electric_rate >= 0),
  due_day        smallint not null default 5 check (due_day between 1 and 28),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- rooms
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique check (btrim(number) <> ''),
  floor         smallint,
  status        text not null default 'vacant'
                check (status in ('vacant', 'occupied', 'reserved', 'maintenance')),
  default_rent  numeric(10,2) not null default 0 check (default_rent >= 0),
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- tenants
create table public.tenants (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null check (btrim(full_name) <> ''),
  phone            text not null default '',
  id_card_ref      text not null default '',   -- free text, e.g. "ID card, last 4: 1234"
  emergency_name   text not null default '',
  emergency_phone  text not null default '',
  notes            text not null default '',
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------- contracts
create table public.contracts (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.rooms (id) on delete restrict,
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  start_date        date not null,
  end_date          date,
  monthly_rent      numeric(10,2) not null check (monthly_rent >= 0),
  deposit           numeric(10,2) not null default 0 check (deposit >= 0),
  status            text not null default 'active' check (status in ('active', 'ended')),
  moved_out_on      date,
  deposit_returned  numeric(10,2) check (deposit_returned >= 0),
  move_out_note     text not null default '',
  created_at        timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check ((status = 'ended') = (moved_out_on is not null)),
  check (moved_out_on is null or moved_out_on >= start_date)
);
-- A room can have only one active contract at a time.
create unique index contracts_one_active_per_room on public.contracts (room_id) where status = 'active';
create index contracts_tenant_idx on public.contracts (tenant_id);

-- ---------------------------------------------------------------- meter readings
-- kind: move_in (start of a contract), monthly (staff's monthly round), move_out (final).
-- month: the billing month this reading belongs to (1st of the month).
create table public.meter_readings (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete restrict,
  kind         text not null check (kind in ('move_in', 'monthly', 'move_out')),
  month        date not null check (extract(day from month) = 1),
  read_on      date not null,
  water        numeric(10,1) not null check (water >= 0),
  electric     numeric(10,1) not null check (electric >= 0),
  recorded_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index meter_one_monthly_per_room_month on public.meter_readings (room_id, month) where kind = 'monthly';
create index meter_room_read_on_idx on public.meter_readings (room_id, read_on);

-- ---------------------------------------------------------------- bills
-- Units and amounts are generated columns, so they can never disagree with the readings/rates.
-- The total is not stored; see the bill_summary view.
create table public.bills (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete restrict,
  contract_id     uuid references public.contracts (id) on delete restrict,  -- null only for imported history
  month           date not null check (extract(day from month) = 1),
  rent            numeric(10,2) not null default 0 check (rent >= 0),
  water_prev      numeric(10,1) not null default 0,
  water_curr      numeric(10,1) not null default 0,
  water_units     numeric(10,1) generated always as (water_curr - water_prev) stored,
  water_rate      numeric(10,2) not null default 0 check (water_rate >= 0),
  water_amount    numeric(10,2) generated always as (round((water_curr - water_prev) * water_rate, 2)) stored,
  elec_prev       numeric(10,1) not null default 0,
  elec_curr       numeric(10,1) not null default 0,
  elec_units      numeric(10,1) generated always as (elec_curr - elec_prev) stored,
  elec_rate       numeric(10,2) not null default 0 check (elec_rate >= 0),
  elec_amount     numeric(10,2) generated always as (round((elec_curr - elec_prev) * elec_rate, 2)) stored,
  due_date        date not null,
  note            text not null default '',
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (room_id, month),
  check (water_curr >= water_prev),
  check (elec_curr >= elec_prev)
);
create index bills_month_idx on public.bills (month);

-- ---------------------------------------------------------------- extra charges
create table public.bill_extras (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.bills (id) on delete cascade,
  label       text not null check (btrim(label) <> ''),
  amount      numeric(10,2) not null check (amount > 0),
  created_at  timestamptz not null default now()
);
create index bill_extras_bill_idx on public.bill_extras (bill_id);

-- ---------------------------------------------------------------- payments
-- Several payments per bill = partial payments. method is null only for imported history.
create sequence public.receipt_no_seq;

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references public.bills (id) on delete restrict,
  amount       numeric(10,2) not null check (amount > 0),
  paid_on      date not null default ((now() at time zone 'Asia/Bangkok')::date),
  method       text check (method in ('cash', 'transfer')),
  receipt_no   text not null unique default ('R-' || lpad(nextval('public.receipt_no_seq')::text, 6, '0')),
  note         text not null default '',
  imported     boolean not null default false,
  recorded_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (method is not null or imported)
);
create index payments_bill_idx on public.payments (bill_id);

grant usage on sequence public.receipt_no_seq to authenticated;
