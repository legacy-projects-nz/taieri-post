-- 011: drivers could read every column of people (rates, emails, licence details) through the API. Now: own row only; names via a narrow view.
create or replace view public.people_public with (security_invoker = false) as select id, name, role, active from public.people;
revoke all on public.people_public from anon;
grant select on public.people_public to authenticated;
drop policy if exists read_all on public.people;
create policy read_self_or_boss on public.people for select using (is_boss() or id = me());
