-- Owner asks a driver about an add-on that wasn't ticked off (marks status 'ask'). The driver answers on their next app open:
--   done = true  → ticked on the original shift, marked late, late penalty logged (same as task_done_late)
--   done = false → marked not done (by the driver, so it doesn't carry over), not-done penalty logged
create or replace function task_answer(p_shift uuid, p_addon text, p_done boolean, p_name text default null) returns void language plpgsql security definer set search_path = public as $$
declare s shifts; pts numeric; k text := 'add|' || p_shift || '|' || p_addon;
begin
  select * into s from shifts where id = p_shift and (driver = me() or has_perm('roster'));
  if not found then raise exception 'not your shift'; end if;
  select coalesce((value->>'perEvent')::numeric, 5) into pts from settings where key = 'rules';
  if p_done then
    update shifts set done = coalesce(done, '{}'::jsonb) || jsonb_build_object(p_addon, now()) where id = p_shift;
    insert into marks (key, driver, status, reviewed, note, by_person, at) values (k, s.driver, 'late', true, 'Driver confirmed done (asked) · counted late', me(), now())
      on conflict (key) do update set status = 'late', reviewed = true, note = excluded.note, by_person = excluded.by_person, at = now();
    insert into entries (driver, day, run, kind, title, note, admin_pts, show_driver, created_by)
      values (s.driver, s.day, s.run, 'adjust', 'Task done late · ' || coalesce(p_name, p_addon), 'Not ticked off on the day; driver confirmed it was done', -coalesce(pts, 5), true, me());
  else
    insert into marks (key, driver, status, reviewed, note, by_person, at) values (k, s.driver, 'miss', true, 'Driver confirmed not done (asked)', me(), now())
      on conflict (key) do update set status = 'miss', reviewed = true, note = excluded.note, by_person = excluded.by_person, at = now();
    insert into entries (driver, day, run, kind, title, note, admin_pts, show_driver, created_by)
      values (s.driver, s.day, s.run, 'adjust', 'Task not done · ' || coalesce(p_name, p_addon), 'Driver confirmed it wasn''t done', -coalesce(pts, 5), true, me());
  end if;
end $$;
revoke execute on function task_answer(uuid, text, boolean, text) from public, anon;
grant execute on function task_answer(uuid, text, boolean, text) to authenticated;
