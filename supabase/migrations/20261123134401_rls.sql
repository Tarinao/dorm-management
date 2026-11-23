-- 0003: Row Level Security.
--   admin : everything
--   staff : read / add / edit everything except settings; cannot delete anything
--   no role (new sign-up not yet approved) or anonymous : nothing

-- ---------------------------------------------------------------- role helpers
create function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() in ('admin', 'staff'), false);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() = 'admin', false);
$$;

revoke execute on function public.app_role(), public.is_member(), public.is_admin() from public, anon;
grant  execute on function public.app_role(), public.is_member(), public.is_admin() to authenticated;

-- The anonymous role never needs table access in this app.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- This project does not auto-grant table privileges to API roles, so grant them
-- explicitly. Privileges only open the door; the RLS policies below decide which rows.
grant select, insert, update, delete on
  public.rooms, public.tenants, public.contracts, public.meter_readings,
  public.bills, public.bill_extras, public.payments
to authenticated;
grant select, update on public.settings to authenticated;
grant select, update on public.profiles to authenticated;

-- service_role (used only by the one-time import script, never in the app) bypasses RLS.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table public.profiles        enable row level security;
alter table public.settings        enable row level security;
alter table public.rooms           enable row level security;
alter table public.tenants         enable row level security;
alter table public.contracts       enable row level security;
alter table public.meter_readings  enable row level security;
alter table public.bills           enable row level security;
alter table public.bill_extras     enable row level security;
alter table public.payments        enable row level security;

-- ---------------------------------------------------------------- profiles
create policy "profiles: read own, admin reads all" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "profiles: admin updates" on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
-- No insert policy (rows come from the signup trigger); no delete policy (deleting the auth user cascades).

-- ---------------------------------------------------------------- settings
create policy "settings: members read" on public.settings
  for select to authenticated
  using ((select public.is_member()));

create policy "settings: admin updates" on public.settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
-- No insert/delete policy: the single row is created by the seed migration.

-- ---------------------------------------------------------------- business tables
-- Same four policies on each: members select/insert/update, admin deletes.
do $$
declare
  t text;
begin
  foreach t in array array['rooms', 'tenants', 'contracts', 'meter_readings', 'bills', 'bill_extras', 'payments']
  loop
    execute format('create policy "%1$s: members read" on public.%1$I for select to authenticated using ((select public.is_member()))', t);
    execute format('create policy "%1$s: members add" on public.%1$I for insert to authenticated with check ((select public.is_member()))', t);
    execute format('create policy "%1$s: members edit" on public.%1$I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
    execute format('create policy "%1$s: admin deletes" on public.%1$I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end;
$$;
