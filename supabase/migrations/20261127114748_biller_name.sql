-- The name printed under the signature line of every invoice ("ลงชื่อ .... ผู้วางบิล").
-- Typed in Settings → Invoice details by the owner (admin-only, like every setting); empty = no name.
alter table public.settings
  add column biller_name text not null default '' check (length(biller_name) <= 100);
