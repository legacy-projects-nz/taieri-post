-- Who is signed in to the app: for the owner's "view as" bar. Only owners / staff with permissions can call it.
create or replace function public.login_status()
returns table(person_id text, has_account boolean, last_sign_in timestamptz, last_active timestamptz, sessions int, push boolean)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.user_id is not null, u.last_sign_in_at,
    (select max(coalesce(s.refreshed_at, s.updated_at, s.created_at)) from auth.sessions s where s.user_id = p.user_id),
    (select count(*)::int from auth.sessions s where s.user_id = p.user_id and (s.not_after is null or s.not_after > now())),
    exists(select 1 from public.push_subs ps where ps.person = p.id)
  from public.people p left join auth.users u on u.id = p.user_id
  where p.active and public.is_boss()
$$;
revoke execute on function public.login_status() from public, anon;
grant execute on function public.login_status() to authenticated;
