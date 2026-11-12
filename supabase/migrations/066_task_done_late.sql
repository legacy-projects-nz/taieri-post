-- A task left undone carries over to the driver's next day (red, before SOD). Ticking it then records it done late:
-- ticks it on the original shift, marks it late, and logs an admin-points penalty (the per-event rate) on the driver's record.
create or replace function task_done_late(p_shift uuid, p_addon text, p_name text default null) returns void language plpgsql security definer set search_path = public as $$
declare s shifts; pts numeric;
begin
  select * into s from shifts where id = p_shift and (driver = me() or has_perm('roster'));
  if not found then raise exception 'not your shift'; end if;
  update shifts set done = coalesce(done, '{}'::jsonb) || jsonb_build_object(p_addon, now()) where id = p_shift;
  insert into marks (key, driver, status, reviewed, note, by_person, at)
    values ('add|' || p_shift || '|' || p_addon, s.driver, 'late', true, 'Done late (carried over to the next day)', me(), now())
    on conflict (key) do update set status = 'late', reviewed = true, note = excluded.note, by_person = excluded.by_person, at = now();
  select coalesce((value->>'perEvent')::numeric, 5) into pts from settings where key = 'rules';
  insert into entries (driver, day, run, kind, title, note, admin_pts, show_driver, created_by)
    values (s.driver, s.day, s.run, 'adjust', 'Task done late · ' || coalesce(p_name, p_addon), 'Not done on the day, completed the next day', -coalesce(pts, 5), true, me());
end $$;
revoke execute on function task_done_late(uuid, text, text) from public, anon;
grant execute on function task_done_late(uuid, text, text) to authenticated;
