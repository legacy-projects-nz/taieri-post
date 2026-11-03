-- Tapping a task's Done button again undoes it (clears the done time), same access rules as task_done.
create or replace function task_undo(p_shift uuid, p_addon text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set done = coalesce(done, '{}'::jsonb) - p_addon where id = p_shift;
end $$;
revoke execute on function task_undo(uuid, text) from public, anon;
grant execute on function task_undo(uuid, text) to authenticated;
