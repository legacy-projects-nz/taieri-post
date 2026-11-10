-- SOR / EOR: drivers on more than one run in a day tap Start of run / End of run.
-- Starting a run also ends the run before it (if it wasn't ended), so each run gets its own real start and finish.
alter table public.shifts add column if not exists sor_at timestamptz, add column if not exists eor_at timestamptz;

create or replace function public.run_mark(p_shift uuid, p_kind text, p_undo boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare s shifts; prev uuid; t timestamptz := now();
begin
  select * into s from shifts where id = p_shift;
  if s.id is null then raise exception 'No such shift'; end if;
  if not (s.driver = me() or has_perm('roster')) then raise exception 'Not your shift'; end if;
  if p_kind = 'sor' then
    if p_undo then update shifts set sor_at = null where id = s.id; return json_build_object('ok', true); end if;
    update shifts set sor_at = coalesce(sor_at, t) where id = s.id;
    -- end the previous run of the day if it's still open
    select id into prev from shifts where driver = s.driver and day = s.day and id <> s.id and run <> 'BU' and coalesce(start_at, '00:00') <= coalesce(s.start_at, '23:59') and eor_at is null
      order by start_at desc limit 1;
    if prev is not null then update shifts set eor_at = t where id = prev; end if;
    return json_build_object('ok', true, 'ended', prev);
  elsif p_kind = 'eor' then
    update shifts set eor_at = case when p_undo then null else coalesce(eor_at, t) end where id = s.id;
    return json_build_object('ok', true);
  end if;
  raise exception 'Unknown mark %', p_kind;
end $$;
revoke execute on function public.run_mark(uuid, text, boolean) from public, anon;
grant execute on function public.run_mark(uuid, text, boolean) to authenticated;
