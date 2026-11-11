-- Nightly clean-up (3:15am NZ summer time) so the tables that grow every day stay small.
--   cron run history   kept 7 days    (five jobs, three of them every minute: about 4,500 rows a day)
--   pg_net responses   kept 2 days
--   app error log      kept 90 days
--   GPS points         kept 12 months (they are the record for lost-parcel claims)
--   resolved alerts    kept 12 months
--   activity log       kept 24 months
-- Rosters, SODs, EODs, pick-ups, leave and anything pay-related are never touched.
create schema if not exists private;
create or replace function private.cleanup() returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  delete from net._http_response where created < now() - interval '2 days';
  delete from public.client_errors where at < now() - interval '90 days';
  delete from public.locations where at < now() - interval '12 months';
  delete from public.alerts where resolved_at is not null and resolved_at < now() - interval '12 months';
  delete from public.activity_log where created_at < now() - interval '24 months';
end $$;
revoke all on function private.cleanup() from public, anon, authenticated;
select cron.schedule('nightly-cleanup', '15 14 * * *', $$ select private.cleanup() $$);
