-- Fix posts: delete a shift. Its SOD, EOD, breaks, alerts and corrections go with it; roster change lines keep their text but lose the link.
create or replace function public.shift_delete(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s shifts;
begin
  if not has_perm('roster') then raise exception 'Only the roster admin can delete shifts'; end if;
  select * into s from shifts where id = p_id; if s.id is null then raise exception 'No such shift'; end if;
  update roster_change_items set shift_id = null where shift_id = p_id;
  update locations set shift_id = null where shift_id = p_id;
  delete from shifts where id = p_id;
  return json_build_object('ok', true, 'day', s.day, 'run', s.run, 'driver', s.driver);
end $$;
revoke execute on function public.shift_delete(uuid) from public, anon;
grant execute on function public.shift_delete(uuid) to authenticated;
