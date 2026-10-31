-- 006: extra sign-in addresses per person (e.g. Jeremy's Gmail for the driver app). Applied 31 Oct 2026.
create table if not exists public.person_logins (
  email text primary key,
  person_id text not null references public.people(id) on delete cascade,
  user_id uuid unique,
  created_at timestamptz not null default now()
);
alter table public.person_logins enable row level security;
revoke all on public.person_logins from anon, authenticated;
insert into public.person_logins (email, person_id) values ('jeremybotting@gmail.com', 'J') on conflict (email) do update set person_id = excluded.person_id;

create or replace function public._pid() returns text language sql stable security definer set search_path = public as $$
  select id from (select id, 0 as o from people where user_id = auth.uid() union all select person_id, 1 from person_logins where user_id = auth.uid()) x order by o limit 1 $$;
revoke execute on function public._pid() from public, anon, authenticated;
create or replace function public.link_person_to_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update people set user_id = new.id where user_id is null and lower(email) = lower(new.email);
  update person_logins set user_id = new.id where user_id is null and lower(email) = lower(new.email);
  return new;
end $$;
create or replace function public.me() returns text language sql stable security definer set search_path = public as $$ select _pid() $$;
create or replace function public.my_role() returns staff_role language sql stable security definer set search_path = public as $$ select role from people where id = _pid() $$;
create or replace function public.has_perm(area text) returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select role = 'owner' or area = any(perms) from people where id = _pid()), false) $$;
create or replace function public.is_boss() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select role = 'owner' or cardinality(perms) > 0 from people where id = _pid()), false) $$;
create or replace function public.staff_ok() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select not (role = 'owner' or cardinality(perms) > 0) from people where id = _pid()), true) or (auth.jwt()->>'aal') = 'aal2' $$;
create or replace function public.whoami() returns setof people language sql stable security definer set search_path = public as $$ select * from people where id = _pid() $$;
create or replace function public.log_event(p_action text, p_detail text) returns void language plpgsql security definer set search_path = public as $$
declare pid text; em text;
begin select id, email into pid, em from people where id = _pid(); insert into activity_log(actor, actor_email, action, detail) values (pid, em, p_action, p_detail); end $$;
create or replace function public.person_for_user(p_uid uuid) returns text language sql stable security definer set search_path = public as $$
  select id from (select id, 0 as o from people where user_id = p_uid union all select person_id, 1 from person_logins where user_id = p_uid) x order by o limit 1 $$;
revoke execute on function public.person_for_user(uuid) from public, anon, authenticated;
grant execute on function public.person_for_user(uuid) to service_role;
