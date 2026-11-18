-- End-of-day mail left photo: on a mail run with mail that day, the driver photographs any mail they couldn't deliver (or taps All delivered)
-- before the EOD. The photo's estimated stops (shifts.mail_left, set by the mailcount function, mode "left") come off the day's mail stops in the TDT.
alter table public.shifts add column if not exists mail_left integer;
alter table public.shifts add column if not exists mail_left_ai jsonb;

create or replace function public.mail_left_none(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set mail_left = 0 where id = p_shift;
end $$;
grant execute on function public.mail_left_none(uuid) to authenticated;
