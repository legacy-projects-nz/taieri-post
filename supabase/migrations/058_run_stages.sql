-- Sort / run stages: a driver with a sort before a run taps ▶ Start [run] (ends the sort); a driver who sorts inside a run
-- taps ▶ Delivering when the sort is done. EOD can set a forgotten start time (p_at) instead of the tap time.
alter table public.shifts add column if not exists deliver_at timestamptz;

drop function if exists public.run_mark(uuid, text, boolean);
create or replace function public.run_mark(p_shift uuid, p_kind text, p_undo boolean default false, p_at timestamptz default null)
returns json language plpgsql security definer set search_path = public as $$
declare s shifts; prev uuid; t timestamptz := coalesce(p_at, now());
begin
  select * into s from shifts where id = p_shift;
  if s.id is null then raise exception 'No such shift'; end if;
  if not (s.driver = me() or has_perm('roster')) then raise exception 'Not your shift'; end if;
  if p_kind = 'sor' then
    if p_undo then update shifts set sor_at = null where id = s.id; return json_build_object('ok', true); end if;
    update shifts set sor_at = case when p_at is not null then p_at else coalesce(sor_at, t) end where id = s.id;
    -- end the previous shift of the day (run or sort) if it's still open
    select id into prev from shifts where driver = s.driver and day = s.day and id <> s.id and run <> 'BU' and coalesce(start_at, '00:00') <= coalesce(s.start_at, '23:59') and eor_at is null
      order by start_at desc limit 1;
    if prev is not null then update shifts set eor_at = t where id = prev; end if;
    return json_build_object('ok', true, 'ended', prev);
  elsif p_kind = 'eor' then
    update shifts set eor_at = case when p_undo then null else coalesce(p_at, eor_at, t) end where id = s.id;
    return json_build_object('ok', true);
  elsif p_kind = 'dlv' then
    update shifts set deliver_at = case when p_undo then null else coalesce(p_at, deliver_at, t) end where id = s.id;
    return json_build_object('ok', true);
  end if;
  raise exception 'Unknown mark %', p_kind;
end $$;
revoke execute on function public.run_mark(uuid, text, boolean, timestamptz) from public, anon;
grant execute on function public.run_mark(uuid, text, boolean, timestamptz) to authenticated;
