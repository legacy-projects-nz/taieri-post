alter table public.alerts add column if not exists last_pushed_at timestamptz, add column if not exists push_count int not null default 0;
-- pg_cron: every minute call the repeat function (re-sends overdue alerts every 5 minutes)
-- select cron.schedule('repeat-overdue-alerts', '* * * * *', $$ select net.http_post(url := '.../functions/v1/repeat', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from app_secrets where key='cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 25000) $$);
