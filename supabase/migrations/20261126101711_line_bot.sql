-- 0013: the LINE OA conversation (welcome, language, menus, dorm information, contact staff).
--   line_users : everyone who has talked to the OA: chosen language, where they are in a menu
--                (menu_state + draft), handover_until (the bot stays quiet while staff chat),
--                wants_talk_at ("Wants to talk" badge in the app until staff mark it done).
--                Rows are written only by the line-webhook function (service role).
--   line_info  : the dorm information the bot answers with, Thai + English, edited by the owner
--                in Settings -> "LINE info". Starts EMPTY: nothing is hardcoded.
--   settings   : office phone and the map pin for the "Location" answer.
--   line_chat_done() : staff mark a "Wants to talk" chat as handled (optionally let the bot answer again).
-- Non-destructive: only adds tables, columns, a function and policies.

-- ---------------------------------------------------------------- line_users
create table public.line_users (
  line_user_id    text primary key check (line_user_id ~ '^U[0-9a-f]{32}$'),
  display_name    text not null default '',
  picture_url     text not null default '',
  lang            text check (lang in ('th', 'en')),           -- null = not chosen yet
  menu_state      text check (menu_state in ('ask_room', 'book_name', 'book_phone', 'book_date')),
  draft           jsonb not null default '{}'::jsonb,           -- answers typed so far (booking)
  handover_until  timestamptz,                                  -- bot silent until then
  wants_talk_at   timestamptz,                                  -- "Wants to talk"; null = nothing waiting
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);
create index line_users_wants_talk_idx on public.line_users (wants_talk_at) where wants_talk_at is not null;

alter table public.line_users enable row level security;
revoke all on public.line_users from anon;
grant select on public.line_users to authenticated;
grant all on public.line_users to service_role;

create policy "line_users: members read" on public.line_users
  for select to authenticated using ((select public.is_member()));
-- No insert / update / delete policies: the webhook (service role) writes; staff use line_chat_done().

-- Staff: "Done" on a Wants-to-talk chat. p_bot_back = true also ends the handover now.
create function public.line_chat_done(p_line_user_id text, p_bot_back boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.line_users
     set wants_talk_at = null,
         handover_until = case when p_bot_back then null else handover_until end
   where line_user_id = p_line_user_id;
end;
$$;
revoke execute on function public.line_chat_done(text, boolean) from public, anon;
grant execute on function public.line_chat_done(text, boolean) to authenticated;

-- ---------------------------------------------------------------- line_info (editable dorm information)
create table public.line_info (
  key         text primary key check (key in ('room_types', 'facilities', 'location', 'house_rules', 'deposit_terms')),
  text_th     text not null default '' check (length(text_th) <= 4500),   -- LINE text messages: max 5000 chars
  text_en     text not null default '' check (length(text_en) <= 4500),
  updated_at  timestamptz not null default now()
);
insert into public.line_info (key) values ('room_types'), ('facilities'), ('location'), ('house_rules'), ('deposit_terms');

create trigger line_info_touch before update on public.line_info
  for each row execute function public.touch_updated_at();

alter table public.line_info enable row level security;
revoke all on public.line_info from anon;
grant select, update on public.line_info to authenticated;
grant all on public.line_info to service_role;

create policy "line_info: members read" on public.line_info
  for select to authenticated using ((select public.is_member()));
create policy "line_info: admin edits" on public.line_info
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- settings: phone + map pin
alter table public.settings
  add column office_phone  text not null default '' check (length(office_phone) <= 40),
  add column location_lat  numeric(9,6) check (location_lat between -90 and 90),
  add column location_lng  numeric(9,6) check (location_lng between -180 and 180),
  add constraint settings_location_both check ((location_lat is null) = (location_lng is null));
