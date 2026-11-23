-- 0001: remove the hand-made prototype tables.
-- Their rows were exported first to data/live_backup_2026-11-23.json, and the
-- import script (scripts/import-old-data.ts) can bring them back into the new schema.
-- DESTRUCTIVE: this deletes the old tables and everything in them.

drop table if exists public.invoices cascade;
drop table if exists public.repairs  cascade;
drop table if exists public.tenants  cascade;
drop table if exists public.rooms    cascade;
drop table if exists public.settings cascade;
