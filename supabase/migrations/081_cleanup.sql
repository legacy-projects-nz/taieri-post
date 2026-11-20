-- Nightly clean-up (edge function "cleanup"): photos older than 12 months, old GPS points, resolved alerts, app error reports.
-- old_photos lists storage files to remove; only the service role can call it.
create or replace function public.old_photos(p_bucket text, p_before timestamptz) returns setof text language sql security definer set search_path = storage, public as $$
  select name from storage.objects where bucket_id = p_bucket and created_at < p_before order by created_at limit 1000 $$;
revoke execute on function public.old_photos(text, timestamptz) from public, anon, authenticated;
grant execute on function public.old_photos(text, timestamptz) to service_role;
-- 3:15am NZ (14:15 UTC in summer; it just shifts an hour in winter)
select cron.schedule('nightly-cleanup', '15 14 * * *', $$ select net.http_post(url := 'https://vuqlrfyqbezwmftikxwt.supabase.co/functions/v1/cleanup', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where key = 'cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 60000) $$);
