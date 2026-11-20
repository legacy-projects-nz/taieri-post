-- shrink (edge function, every 15 min): photos still stored full size (over ~600 KB), oldest first, leaving out ones it already couldn't shrink.
-- Resizing is done by Supabase's image service; new photos are already shrunk on the phone, so this mostly catches older uploads.
create or replace function public.big_photos(p_skip text[] default '{}', p_limit int default 8) returns table(bucket text, name text, size bigint) language sql security definer set search_path = storage, public as $$
  select o.bucket_id, o.name, (o.metadata->>'size')::bigint from storage.objects o
  where o.bucket_id in ('runsheets','vchk','errs') and (o.metadata->>'size')::bigint > 600000 and not ((o.bucket_id || '/' || o.name) = any (coalesce(p_skip, '{}')))
  order by o.created_at limit p_limit $$;
revoke execute on function public.big_photos(text[], int) from public, anon, authenticated;
grant execute on function public.big_photos(text[], int) to service_role;
select cron.schedule('shrink-photos', '*/15 * * * *', $$ select net.http_post(url := 'https://vuqlrfyqbezwmftikxwt.supabase.co/functions/v1/shrink', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where key = 'cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000) $$);
