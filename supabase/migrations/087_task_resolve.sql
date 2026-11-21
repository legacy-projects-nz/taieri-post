-- Before SOD, a driver sorts out every outstanding task from an earlier day with one of:
--   done  → it was done on the day, just not ticked: ticked, no penalty, left for Jeremy to review (mark ok, not reviewed)
--   late  → done after the day: ticked, marked late, late penalty (same as task_done_late)
--   miss  → not done: marked not done, not-done penalty (same as task_answer false)
create or replace function public.task_resolve(p_shift uuid, p_addon text, p_status text, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s shifts; pts numeric; k text := 'add|' || p_shift || '|' || p_addon;
begin
  select * into s from shifts where id = p_shift and (driver = me() or has_perm('roster'));
  if not found then raise exception 'not your shift'; end if;
  if p_status not in ('done', 'late', 'miss') then raise exception 'bad status'; end if;
  select coalesce((value->>'perEvent')::numeric, 5) into pts from settings where key = 'rules';
  if p_status in ('done', 'late') then
    update shifts set done = coalesce(done, '{}'::jsonb) || jsonb_build_object(p_addon, coalesce(done -> p_addon, to_jsonb(now()))) where id = p_shift;
  end if;
  insert into marks (key, driver, status, reviewed, note, by_person, at)
    values (k, s.driver, case p_status when 'done' then 'ok' else p_status end, p_status <> 'done',
      case p_status when 'done' then 'Driver: done on the day, not ticked (check)' when 'late' then 'Driver: done late' else 'Driver: not done' end, me(), now())
    on conflict (key) do update set status = excluded.status, reviewed = excluded.reviewed, note = excluded.note, by_person = excluded.by_person, at = now();
  if p_status <> 'done' then
    insert into entries (driver, day, run, kind, title, note, admin_pts, show_driver, created_by)
      values (s.driver, s.day, s.run, 'adjust', case p_status when 'late' then 'Task done late · ' else 'Task not done · ' end || coalesce(p_name, p_addon),
        case p_status when 'late' then 'Done after the day' else 'Driver confirmed it wasn''t done' end, -coalesce(pts, 5), true, me());
  end if;
end $$;
revoke execute on function public.task_resolve(uuid, text, text, text) from public, anon;
grant execute on function public.task_resolve(uuid, text, text, text) to authenticated;
