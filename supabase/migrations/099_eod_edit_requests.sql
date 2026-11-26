-- EOD edits by drivers need Jeremy's approval (26 Nov 2026).
-- The edit is saved straight away (so drivers are never stuck), and an approval request is raised with the before / after.
-- Approve keeps it; Decline puts the EOD back to what it was before the edit.
create table if not exists public.eod_edits (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  driver      text not null references public.people(id),
  day         date not null,
  run         text,
  before      jsonb not null,
  after       jsonb not null,
  status      text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by  text references public.people(id),
  decided_at  timestamptz,
  reply       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists eod_edits_one_pending on public.eod_edits (shift_id) where status = 'pending';
create index if not exists eod_edits_day_idx on public.eod_edits (day);
alter table public.eod_edits enable row level security;
create policy eodedit_read on public.eod_edits for select to authenticated using (driver = me() or is_boss());
create policy require_2fa_staff on public.eod_edits as restrictive to authenticated using (staff_ok()) with check (staff_ok());

-- the figures an EOD edit can change
create or replace function public.eod_figs(e public.eod) returns jsonb language sql immutable as $$
  select jsonb_build_object('finish_time', e.finish_time, 'parcels', e.parcels, 'stops', e.stops, 'pickups', e.pickups, 'pickup_parcels', e.pickup_parcels,
    'sort_min', e.sort_min, 'trays', e.trays, 'cycled', e.cycled, 'legs', to_jsonb(e.legs), 'newspapers', e.newspapers, 'mail_stops', e.mail_stops,
    'note', e.note, 'extra', e.extra)
$$;

-- a driver's own edit raises (or tops up) the request; Jeremy's edits, edits to someone else's EOD and the system (8pm check) don't
create or replace function public.eod_edit_track() returns trigger language plpgsql security definer set search_path = public as $$
declare b jsonb := eod_figs(old); a jsonb := eod_figs(new); s shifts;
begin
  if me() is null or my_role() = 'owner' or me() is distinct from old.driver or a = b then return new; end if;
  select * into s from shifts where id = new.shift_id;
  update eod_edits set after = a, updated_at = now() where shift_id = new.shift_id and status = 'pending';
  if not found then
    insert into eod_edits (shift_id, driver, day, run, before, after) values (new.shift_id, old.driver, s.day, s.run, b, a);
  end if;
  return new;
end $$;
drop trigger if exists eod_edit_track on public.eod;
create trigger eod_edit_track after update on public.eod for each row execute function public.eod_edit_track();

create or replace function public.eod_edit_decide(p_id uuid, p_approve boolean, p_reply text default null)
returns public.eod_edits language plpgsql security definer set search_path = public as $$
declare r eod_edits; b jsonb;
begin
  if my_role() is distinct from 'owner' and my_role() is distinct from 'admin' then raise exception 'Only Jeremy or admin can approve EOD edits'; end if;
  select * into r from eod_edits where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.driver = me() and my_role() <> 'owner' then raise exception 'You can''t approve your own EOD edit'; end if;
  if r.status <> 'pending' then raise exception 'Already %', r.status; end if;
  if not p_approve then b := r.before;
    update eod set finish_time = (b->>'finish_time')::time, parcels = (b->>'parcels')::int, stops = (b->>'stops')::int, pickups = (b->>'pickups')::int,
      pickup_parcels = (b->>'pickup_parcels')::int, sort_min = (b->>'sort_min')::int, trays = (b->>'trays')::numeric, cycled = (b->>'cycled')::int,
      legs = coalesce(array(select jsonb_array_elements_text(b->'legs')), '{}'), newspapers = coalesce((b->>'newspapers')::boolean, false),
      mail_stops = (b->>'mail_stops')::int, note = b->>'note', extra = coalesce(b->'extra', '{}'::jsonb), edited_at = now(), edited_by = me()
    where shift_id = r.shift_id;
  end if;
  update eod_edits set status = case when p_approve then 'approved' else 'declined' end, decided_by = me(), decided_at = now(), reply = nullif(p_reply, '')
    where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.eod_edit_decide(uuid, boolean, text) from public, anon;
grant execute on function public.eod_edit_decide(uuid, boolean, text) to authenticated;

alter publication supabase_realtime add table public.eod_edits;
