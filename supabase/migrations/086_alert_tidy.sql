-- Nightly alert tidy-up: a past week's vehicle-check alerts and EOD-late alerts over a week old are closed
-- (the scorecard keeps the record). Runs 2am NZ.
create or replace function public.tidy_alerts() returns void language sql security definer set search_path = public as $$
  update alerts set resolved_at = now() where resolved_at is null and (
    (dedupe_key like 'vchk|%' and split_part(dedupe_key, '|', 2)::date < date_trunc('week', (now() at time zone 'Pacific/Auckland'))::date)
    or (kind in ('eod_late', 'sod_late') and created_at < now() - interval '7 days'));
$$;
select cron.schedule('tidy-alerts', '0 13 * * *', $$select public.tidy_alerts()$$);
select public.tidy_alerts();
