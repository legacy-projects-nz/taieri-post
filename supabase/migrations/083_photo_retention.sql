-- photo retention by type (nightly "cleanup" function): list files in a bucket older than a date, optionally only names matching a pattern
create or replace function public.old_photos(p_bucket text, p_before timestamptz, p_like text default null, p_not_like text[] default null) returns setof text language sql security definer set search_path = storage, public as $$
  select name from storage.objects where bucket_id = p_bucket and created_at < p_before
    and (p_like is null or name like p_like) and (p_not_like is null or not (name like any (p_not_like)))
  order by created_at limit 1000 $$;
-- mistake photos: kept while the driver works here, removed once they've left and the photo is over 12 months old
create or replace function public.old_err_photos(p_before timestamptz) returns setof text language sql security definer set search_path = storage, public as $$
  select o.name from storage.objects o left join public.people p on p.id = (storage.foldername(o.name))[1]
  where o.bucket_id = 'errs' and o.created_at < p_before and coalesce(p.active, false) = false order by o.created_at limit 1000 $$;
revoke execute on function public.old_photos(text, timestamptz, text, text[]) from public, anon, authenticated;
revoke execute on function public.old_err_photos(timestamptz) from public, anon, authenticated;
grant execute on function public.old_photos(text, timestamptz, text, text[]) to service_role;
grant execute on function public.old_err_photos(timestamptz) to service_role;
drop function if exists public.old_photos(text, timestamptz);
