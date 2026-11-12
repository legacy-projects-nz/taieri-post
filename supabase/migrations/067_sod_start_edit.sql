-- Start-time sign-off: Jeremy (owner) and admin staff can now both sign off, and can edit the time the driver started
-- before approving (or declining). The edited time becomes the start used for hours and efficiency (sod.start_at), and on
-- approval that day's run times move to match the edited start rather than the raw SOD tap.
alter table public.sod add column if not exists start_at time;               -- start time set at sign-off (overrides sent_at for hours)
alter table public.sod_requests add column if not exists sod_at time;        -- the raw SOD time, kept when the start is edited

-- only the owner/admins may set sod.start_at (drivers can otherwise update their own SOD before the EOD)
create or replace function public.sod_start_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.start_at is distinct from old.start_at and coalesce(my_role()::text, '') not in ('owner','admin') then
    raise exception 'Only Jeremy or admin can change the start time';
  end if;
  return new;
end $$;
drop trigger if exists sod_start_guard on public.sod;
create trigger sod_start_guard before update on public.sod for each row execute function public.sod_start_guard();

drop function if exists public.sod_request_decide(uuid, boolean, text);
-- p_started: the start time to use (null = the time the driver tapped SOD / the time already set).
-- A pending request can be approved or declined; an approved one can be re-approved with a corrected start.
create or replace function public.sod_request_decide(p_id uuid, p_approve boolean, p_reply text default null, p_started time default null)
returns public.sod_requests language plpgsql security definer set search_path = public as $$
declare r public.sod_requests; m jsonb; s public.shifts; v_st time; v_delta int; v_shift int; v_moves jsonb := '[]'; ns int; ne int; v_raw time;
begin
  if coalesce(my_role()::text, '') not in ('owner','admin') then raise exception 'Only Jeremy or admin can sign off start times'; end if;
  select * into r from sod_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' and not (r.status = 'approved' and p_approve) then raise exception 'Already %', r.status; end if;
  v_st := coalesce(p_started, r.started); v_raw := coalesce(r.sod_at, r.started);   -- v_raw = the time the driver actually tapped SOD
  v_delta := (extract(epoch from v_st) - extract(epoch from r.rostered))::int / 60;
  v_shift := v_delta - r.delta_min;   -- how far the edited start moves the times already worked out
  for m in select * from jsonb_array_elements(r.moves) loop
    ns := least(1439, greatest(0, (extract(epoch from (m->>'start_at')::time)::int / 60) + v_shift));
    ne := case when m->>'end_at' is null then null else least(1439, greatest(0, (extract(epoch from (m->>'end_at')::time)::int / 60) + v_shift)) end;
    m := jsonb_build_object('shift_id', m->>'shift_id', 'start_at', to_char(make_time(ns / 60, ns % 60, 0), 'HH24:MI:SS'),
                            'end_at', case when ne is null then null else to_char(make_time(ne / 60, ne % 60, 0), 'HH24:MI:SS') end);
    v_moves := v_moves || jsonb_build_array(m);
    if p_approve then
      s := null;
      update shifts set start_at = (m->>'start_at')::time, end_at = (m->>'end_at')::time
        where id = (m->>'shift_id')::uuid and driver = r.driver returning * into s;
      if s.id is not null then
        update roster_sent set snapshot = snapshot || jsonb_build_object('start_at', left(m->>'start_at', 5), 'end_at', left(m->>'end_at', 5))
          where shift_key = s.day || '|' || s.run || '|' || s.slot and snapshot ? 'driver';
      end if;
    end if;
  end loop;
  update sod set start_at = nullif(v_st, v_raw) where shift_id = r.shift_id;
  update sod_requests set status = case when p_approve then 'approved' else 'declined' end, decided_by = me(), decided_at = now(), reply = coalesce(nullif(p_reply, ''), reply),
      sod_at = case when v_st <> v_raw then v_raw end,
      started = v_st, delta_min = v_delta, kind = case when v_delta < 0 then 'early' else 'late' end, moves = v_moves
    where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.sod_request_decide(uuid, boolean, text, time) from public, anon;
grant execute on function public.sod_request_decide(uuid, boolean, text, time) to authenticated;
