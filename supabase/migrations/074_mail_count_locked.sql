-- Mail stops come only from the photo count (mailcount edge function writes shifts.mail_stops); drivers can't set or change them.
-- Owner / roster admins can still correct them (set_run_figs, or the Mail stops cell on the Efficiency table).
-- "No mail trays today" sets 0 and ticks the task. West Harbour runs (PCB, RSB, WH) can carry mail any day: the task is on every day now.
create or replace function public.set_run_figs(p_shift uuid, p_scan integer default null, p_mail integer default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  if p_mail is not null and not has_perm('roster') then raise exception 'mail stops come from the tray photo count'; end if;
  if p_scan is not null and (p_scan < 0 or p_scan > 2000) then raise exception 'scanner total looks wrong'; end if;
  if p_mail is not null and (p_mail < 0 or p_mail > 2000) then raise exception 'mail stops look wrong'; end if;
  update shifts set scan_parcels = coalesce(p_scan, scan_parcels), mail_stops = coalesce(p_mail, mail_stops) where id = p_shift;
end $$;

create or replace function public.mail_none(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set mail_stops = 0, done = done || jsonb_build_object('tw_mailtrays', now()) where id = p_shift;
end $$;
grant execute on function public.mail_none(uuid) to authenticated;

update public.timing_rules set days = array[1,2,3,4,5,6] where id = 'mailtrays_wh';
