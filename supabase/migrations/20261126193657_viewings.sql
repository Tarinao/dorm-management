-- 0014: viewing appointments, separate from reservations.
--   A viewing = someone wants to come and SEE a room. No room is held, no fee, no expiry.
--   A reservation (0012) = a room is held for someone. Staff can make a reservation from a viewing
--   ("Reserve a room" on the viewing), which links the two (viewings.reservation_id).
--   The LINE bot's "Book a viewing" now creates a viewing (date + time of day), not a reservation.
--
--   viewings   : guest, phone, LINE id, visit date, time of day (morning / afternoon / evening / any),
--                exact time once agreed, optional room to show, status, note, source.
--   status     : requested -> confirmed -> viewed | no_show ; cancelled at any time before.
--   line_users : one more menu step, 'book_time' (the bot asks the time of day after the date).
--   Data move  : LINE requests saved as pending reservations before this (no room, no fee) become
--                viewings and are removed from reservations.
-- Members read / add / edit, admin deletes (same as reservations).

create table public.viewings (
  id              uuid primary key default gen_random_uuid(),
  guest_name      text not null check (btrim(guest_name) <> '' and length(guest_name) <= 100),
  phone           text not null default '' check (length(phone) <= 30),
  line_user_id    text check (line_user_id ~ '^U[0-9a-f]{32}$'),
  visit_date      date not null,
  time_of_day     text not null default 'any' check (time_of_day in ('morning', 'afternoon', 'evening', 'any')),
  visit_time      time,                                    -- exact time once staff agree it
  room_id         uuid references public.rooms (id) on delete set null,          -- room to show (optional)
  status          text not null default 'requested'
                  check (status in ('requested', 'confirmed', 'viewed', 'no_show', 'cancelled')),
  note            text not null default '' check (length(note) <= 2000),
  source          text not null default 'staff' check (source in ('staff', 'line')),
  reservation_id  uuid references public.reservations (id) on delete set null,   -- made from this viewing
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index viewings_status_idx on public.viewings (status, visit_date);

create trigger viewings_touch before update on public.viewings
  for each row execute function public.touch_updated_at();

alter table public.viewings enable row level security;
revoke all on public.viewings from anon;
grant select, insert, update, delete on public.viewings to authenticated;
grant all on public.viewings to service_role;

create policy "viewings: members read" on public.viewings
  for select to authenticated using ((select public.is_member()));
create policy "viewings: members add" on public.viewings
  for insert to authenticated with check ((select public.is_member()));
create policy "viewings: members edit" on public.viewings
  for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "viewings: admin deletes" on public.viewings
  for delete to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------- LINE bot: the time-of-day step
alter table public.line_users drop constraint line_users_menu_state_check;
alter table public.line_users add constraint line_users_menu_state_check
  check (menu_state in ('ask_room', 'book_name', 'book_phone', 'book_date', 'book_time'));

-- ---------------------------------------------------------------- move the old LINE requests
-- Only untouched LINE requests: still pending, no room chosen, no booking fee.
with moved as (
  delete from public.reservations
   where source = 'line' and status = 'pending' and room_id is null and booking_fee = 0
  returning guest_name, phone, line_user_id, desired_move_in, note, created_at
)
insert into public.viewings (guest_name, phone, line_user_id, visit_date, time_of_day, status, note, source, created_by, created_at)
select guest_name, phone, line_user_id, desired_move_in, 'any', 'requested', note, 'line', null, created_at
  from moved;
