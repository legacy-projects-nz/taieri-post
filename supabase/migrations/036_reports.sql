-- Daily and weekly spreadsheet emails to the owner (7 Nov 2026). The report function sends each once; this logs it.
create table if not exists report_log (key text primary key, sent_at timestamptz, sent_to text, detail jsonb);
alter table report_log enable row level security;
create policy report_log_read on report_log for select to authenticated using (is_boss());
-- Every hour on the hour; the function sends the daily at/after 8:40pm NZ and the weekly on Sunday at/after 9pm NZ.
select cron.schedule('owner-reports', '45 * * * *', $$
  select net.http_post(
    url := 'https://vuqlrfyqbezwmftikxwt.supabase.co/functions/v1/report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where key = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$$);
