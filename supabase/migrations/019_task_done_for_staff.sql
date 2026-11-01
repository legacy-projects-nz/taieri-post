-- Owner / roster staff can tap Done on a driver's task (view-as), not only the driver.
create or replace function task_done(p_shift uuid, p_addon text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set done = done || jsonb_build_object(p_addon, now()) where id = p_shift;
end $$;
