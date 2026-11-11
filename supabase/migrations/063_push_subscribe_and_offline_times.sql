-- 1) Push: one function to store a phone's notification subscription against the signed-in person.
--    A phone that was last used by someone else (or whose record was lost) is simply moved to whoever is signed in now;
--    the plain table upsert used before failed in that case.
create or replace function public.push_subscribe(p_endpoint text, p_keys jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare pid text := me();
begin
  if pid is null then raise exception 'not signed in'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or p_keys is null then raise exception 'bad subscription'; end if;
  insert into push_subs(person, endpoint, keys) values (pid, p_endpoint, p_keys)
  on conflict (endpoint) do update set person = excluded.person, keys = excluded.keys;
end $$;
revoke all on function public.push_subscribe(text, jsonb) from public, anon;
grant execute on function public.push_subscribe(text, jsonb) to authenticated;

-- 2) Offline: a task ticked with no signal is sent later, with the time it was actually ticked.
--    Only a time in the last 18 hours is accepted; anything else is stamped with the time it arrives, as before.
drop function if exists public.task_done(uuid, text);
create function public.task_done(p_shift uuid, p_addon text, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set done = done || jsonb_build_object(p_addon, case when p_at is not null and p_at <= now() and p_at > now() - interval '18 hours' then p_at else now() end) where id = p_shift;
end $$;
revoke all on function public.task_done(uuid, text, timestamptz) from public, anon;
grant execute on function public.task_done(uuid, text, timestamptz) to authenticated, service_role;
