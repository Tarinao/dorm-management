-- 0011: schedule the LINE jobs (pg_cron + pg_net).
--   line-monthly-bills  : 01:00 UTC on the 1st  = 08:00 Bangkok -> monthly-bills { mode: 'monthly' }
--   line-bill-reminders : 02:00 UTC every day   = 09:00 Bangkok -> monthly-bills { mode: 'remind' }
-- Both do nothing while Settings -> "Send bills on LINE automatically" is off.
--
-- BEFORE applying: the cron secret must exist in TWO places with the same value (never in code):
--   1. Vault secret named 'cron_secret'  (read below when the job runs)
--   2. Edge Function secret CRON_SECRET  (checked by the monthly-bills function)
-- See README -> "LINE: scheduled jobs".
--
-- To stop the jobs later:  select cron.unschedule('line-monthly-bills'); select cron.unschedule('line-bill-reminders');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    raise exception 'Create the Vault secret "cron_secret" first (see README: LINE scheduled jobs).';
  end if;
end;
$$;

select cron.schedule(
  'line-monthly-bills',
  '0 1 1 * *',
  $job$
  select net.http_post(
    url     := 'https://fetettlfpbndmhueqaxd.supabase.co/functions/v1/monthly-bills',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{"mode":"monthly"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'line-bill-reminders',
  '0 2 * * *',
  $job$
  select net.http_post(
    url     := 'https://fetettlfpbndmhueqaxd.supabase.co/functions/v1/monthly-bills',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{"mode":"remind"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
