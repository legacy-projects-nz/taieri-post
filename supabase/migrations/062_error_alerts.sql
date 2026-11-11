-- Error alerts: every 10 minutes, any new entry in the app error log is emailed to the owner (one email, up to 50 errors).
-- "No signal" errors (failed loads) are skipped: they are normal on the rural runs and the app handles them.
-- Needs 060 (the Resend key is read from Vault).
alter table public.client_errors add column if not exists alerted_at timestamptz;
update public.client_errors set alerted_at = now() where alerted_at is null;   -- nothing already in the log is sent
create index if not exists client_errors_unalerted on public.client_errors (at) where alerted_at is null;

create schema if not exists private;
create or replace function private.send_error_alerts() returns void language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_n int; v_key text; v_from text; v_to jsonb; v_rows text;
begin
  -- connection errors: mark as seen, never emailed
  update public.client_errors set alerted_at = now()
   where alerted_at is null and message ~* '(load failed|failed to fetch|networkerror|network request failed|the network connection was lost|aborted|timed out)';
  select array_agg(id), count(*) into v_ids, v_n from (select id from public.client_errors where alerted_at is null order by at limit 50) x;
  if coalesce(v_n, 0) = 0 then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  select coalesce(s.value->>'email_from', 'Taieri Post <onboarding@resend.dev>') into v_from from public.settings s where s.key = 'links';
  select jsonb_agg(p.email) into v_to from public.people p where p.role = 'owner' and p.active and p.email is not null;
  if v_key is null or v_to is null then return; end if;   -- not set up yet: leave them for the next run
  select string_agg(
    '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">' || to_char(e.at at time zone 'Pacific/Auckland', 'Dy DD Mon HH24:MI') || '</td>'
    || '<td style="padding:6px 10px;border-bottom:1px solid #eee">' || replace(replace(replace(coalesce(p.name, e.person, 'not signed in'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</td>'
    || '<td style="padding:6px 10px;border-bottom:1px solid #eee">' || replace(replace(replace(coalesce(e.app, '') || ' · ' || coalesce(e.kind, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</td>'
    || '<td style="padding:6px 10px;border-bottom:1px solid #eee"><b>' || replace(replace(replace(left(coalesce(e.message, ''), 300), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</b><br><span style="color:#777;font-size:12px">'
    || replace(replace(replace(left(coalesce(e.url, '') || ' · ' || coalesce(e.ua, ''), 160), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</span></td></tr>', '' order by e.at)
    into v_rows
    from public.client_errors e left join public.people p on p.id = e.person where e.id = any(v_ids);
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', v_from, 'to', v_to,
      'subject', '[TP SYSTEM EMAIL] App error' || case when v_n = 1 then '' else 's (' || v_n || ')' end,
      'html', '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>The Taieri Post app logged ' || case when v_n = 1 then 'an error' else v_n || ' errors' end
        || ' in the last 10 minutes.</p><table style="border-collapse:collapse"><tr><th align="left" style="padding:6px 10px">When</th><th align="left" style="padding:6px 10px">Who</th><th align="left" style="padding:6px 10px">Where</th><th align="left" style="padding:6px 10px">What</th></tr>'
        || v_rows || '</table><p style="color:#777;font-size:12px">Full details (including the stack trace) are in the owner portal error log. Connection errors are not emailed.</p></div>'),
    timeout_milliseconds := 15000);
  update public.client_errors set alerted_at = now() where id = any(v_ids);
end $$;
revoke all on function private.send_error_alerts() from public, anon, authenticated;
select cron.schedule('error-alerts', '*/10 * * * *', $$ select private.send_error_alerts() $$);
