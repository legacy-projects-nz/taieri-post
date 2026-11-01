-- Fortnightly email to Alejandro: on-call / back-up allowances owed per driver.
-- Pay periods are 14 days from Mon 2 Nov 2026. The payperiod function sends on the Monday after each period ends.
create table if not exists pay_period_reports (
  period_start date primary key,
  period_end date not null,
  sent_at timestamptz,
  sent_to text,
  total numeric,
  detail jsonb
);
alter table pay_period_reports enable row level security;
create policy roster_read on pay_period_reports for select to authenticated using (has_perm('roster'));
-- Checks every Monday at 18:30 UTC Sunday (7:30am NZ summer time / 6:30am winter). The function itself only sends on a pay-period Monday.
select cron.schedule('payperiod-report', '30 18 * * 0', $$
  select net.http_post(
    url := 'https://vuqlrfyqbezwmftikxwt.supabase.co/functions/v1/payperiod',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where key = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 25000)
$$);
