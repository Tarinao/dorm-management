-- 0009: payment settings, tenant nicknames, and linking tenants to LINE.
--   settings  : PromptPay / bank / office details (typed in by the owner on the Settings page;
--               they start EMPTY here on purpose: no real values in code, migrations or seeds),
--               and the auto-send switch (off).
--   tenants   : nickname, and the LINE account linked to the tenant (one LINE user -> one tenant).
--   line_link_requests : "I am room 101" messages from LINE, waiting for staff to approve or reject.
--   approve_line_request / reject_line_request : the staff actions, each one transaction.
--   move_out  : now also clears the tenant's LINE link.
-- RLS: settings keep their policies (members read, admin edits). Requests: members read/update,
-- admin deletes; rows are only created by the line-webhook Edge Function (service role).

-- ---------------------------------------------------------------- settings: payment details
alter table public.settings
  add column promptpay_id        text    not null default ''
    check (promptpay_id = '' or promptpay_id ~ '^(0[0-9]{9}|[0-9]{13})$'),   -- 10-digit phone or 13-digit ID, digits only
  add column bank_name           text    not null default '',
  add column bank_branch         text    not null default '',
  add column bank_account_name   text    not null default '',
  add column bank_account_number text    not null default ''
    check (bank_account_number ~ '^[0-9-]*$'),
  add column office_location     text    not null default '',
  add column office_hours        text    not null default '',
  add column auto_send_enabled   boolean not null default false;

-- ---------------------------------------------------------------- tenants: nickname + LINE link
alter table public.tenants
  add column nickname          text not null default '',
  add column line_user_id      text unique                       -- null = not linked
    check (line_user_id ~ '^U[0-9a-f]{32}$'),
  add column line_display_name text not null default '',          -- the tenant's LINE name when linked
  add column line_linked_at    timestamptz;

-- ---------------------------------------------------------------- LINE link requests
create table public.line_link_requests (
  id                 uuid primary key default gen_random_uuid(),
  line_user_id       text not null check (line_user_id ~ '^U[0-9a-f]{32}$'),
  line_display_name  text not null default '',
  line_picture_url   text not null default '',
  room_number_typed  text not null check (btrim(room_number_typed) <> '' and length(room_number_typed) <= 10),
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at         timestamptz not null default now(),
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  tenant_id          uuid references public.tenants (id) on delete set null,   -- the tenant linked on approval
  check ((status = 'pending') = (decided_at is null))
);
-- At most ONE waiting request per LINE user (typing again updates it instead of adding rows).
create unique index line_link_one_pending_per_user on public.line_link_requests (line_user_id) where status = 'pending';
create index line_link_status_idx on public.line_link_requests (status, created_at desc);

alter table public.line_link_requests enable row level security;
revoke all on public.line_link_requests from anon;
grant select, update, delete on public.line_link_requests to authenticated;
grant all on public.line_link_requests to service_role;

create policy "line_link_requests: members read" on public.line_link_requests
  for select to authenticated using ((select public.is_member()));
create policy "line_link_requests: members edit" on public.line_link_requests
  for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "line_link_requests: admin deletes" on public.line_link_requests
  for delete to authenticated using ((select public.is_admin()));
-- No insert policy: requests come only from the line-webhook function (service role).

-- ---------------------------------------------------------------- approve
-- Links the LINE user to the CURRENT active tenant of the room they typed.
-- A LINE user can be linked to one tenant only: if they were linked to someone else, that old
-- link is removed (staff chose this by approving; the app warns before). previous_room says
-- which room it was moved from. The LINE message itself is sent by the line-link Edge Function.
create function public.approve_line_request(p_request_id uuid)
returns table (line_user_id text, room_number text, tenant_full_name text, tenant_nickname text,
               line_display_name text, previous_room text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req    record;
  v_target record;
  v_prev   text;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_req from public.line_link_requests r where r.id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = 'P0001';
  end if;

  select rm.number, t.id as tenant_id, t.full_name, t.nickname
    into v_target
    from public.rooms rm
    join public.contracts c on c.room_id = rm.id and c.status = 'active'
    join public.tenants t on t.id = c.tenant_id
   where rm.number = v_req.room_number_typed;
  if not found then
    raise exception 'ROOM_HAS_NO_TENANT' using errcode = 'P0001';
  end if;

  select rm.number into v_prev
    from public.tenants t
    left join public.contracts c on c.tenant_id = t.id and c.status = 'active'
    left join public.rooms rm on rm.id = c.room_id
   where t.line_user_id = v_req.line_user_id and t.id <> v_target.tenant_id
   limit 1;

  update public.tenants t
     set line_user_id = null, line_display_name = '', line_linked_at = null
   where t.line_user_id = v_req.line_user_id and t.id <> v_target.tenant_id;

  update public.tenants t
     set line_user_id = v_req.line_user_id, line_display_name = v_req.line_display_name, line_linked_at = now()
   where t.id = v_target.tenant_id;

  update public.line_link_requests r
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), tenant_id = v_target.tenant_id
   where r.id = p_request_id;

  return query select v_req.line_user_id, v_target.number, v_target.full_name, v_target.nickname,
                      v_req.line_display_name, v_prev;
end;
$$;

-- ---------------------------------------------------------------- reject
create function public.reject_line_request(p_request_id uuid)
returns table (line_user_id text, room_number_typed text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_req record;
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select * into v_req from public.line_link_requests r where r.id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = 'P0001';
  end if;
  update public.line_link_requests r
     set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where r.id = p_request_id;
  return query select v_req.line_user_id, v_req.room_number_typed;
end;
$$;

-- ---------------------------------------------------------------- move out also clears the LINE link
-- Same signature and behaviour as 0004, plus: the tenant's line_user_id is cleared.
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

  update public.rooms set status = p_room_status where id = v_room;

  update public.tenants
     set line_user_id = null, line_display_name = '', line_linked_at = null
   where id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------- function permissions
revoke execute on function public.approve_line_request(uuid), public.reject_line_request(uuid) from public, anon;
grant  execute on function public.approve_line_request(uuid), public.reject_line_request(uuid) to authenticated;
