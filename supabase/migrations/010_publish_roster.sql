-- 010: two-step roster flow. Approve roster = publish the week to drivers' apps (silent).
-- Push changes (later edits) = email + app alert + Got it, handled by the existing roster_changes flow.
alter table public.week_notes add column if not exists published_at timestamptz;
alter table public.week_notes add column if not exists published_by text;

create or replace function public.week_published(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from week_notes where week_start = date_trunc('week', d::timestamp)::date and published_at is not null)
$$;
grant execute on function public.week_published(date) to authenticated;

-- snapshot of a shift as the Run Board app compares it
create or replace function public._shift_snap(s shifts) returns jsonb
language sql immutable as $$
  select jsonb_build_object('driver', s.driver, 'van', s.van,
    'start_at', to_char(s.start_at, 'HH24:MI'), 'end_at', to_char(s.end_at, 'HH24:MI'),
    'addons', coalesce((select jsonb_agg(a order by a) from unnest(s.addons) a), '[]'::jsonb), 'trainee', s.trainee)
$$;

create or replace function public.publish_week(wk date) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('week', wk::timestamp)::date; me text := _pid();
begin
  if not (has_perm('roster') and has_perm('roster_approve')) then raise exception 'Only the owner or roster approvers can approve a roster'; end if;
  insert into week_notes(week_start, notes, updated_at, published_at, published_by) values (m, '', now(), now(), me)
    on conflict (week_start) do update set published_at = now(), published_by = me;
  -- what drivers now have = this roster, so it does not show up as "changes"
  insert into roster_sent(shift_key, snapshot, sent_at)
    select s.day || '|' || s.run || '|' || s.slot, _shift_snap(s), now() from shifts s
    where s.day >= m and s.day < m + 7 and s.run <> 'BU' and s.driver is not null
    on conflict (shift_key) do nothing;
  update shifts set updated_at = now() where day >= m and day < m + 7; -- nudges drivers' live feed
end $$;
grant execute on function public.publish_week(date) to authenticated;

-- drivers only see published weeks; staff (owner / anyone with a permission) see everything
drop policy if exists read_all on public.shifts;
create policy read_published on public.shifts for select using (is_boss() or week_published(day));

-- existing weeks stay visible (they already were): backfill
insert into week_notes(week_start, notes, updated_at, published_at, published_by)
  select distinct date_trunc('week', day::timestamp)::date, '', now(), now(), 'J' from shifts
  on conflict (week_start) do update set published_at = coalesce(week_notes.published_at, now()), published_by = coalesce(week_notes.published_by, 'J');

-- drivers have already been given the current roster: record it so nothing is flagged as a change
insert into roster_sent(shift_key, snapshot, sent_at)
  select s.day || '|' || s.run || '|' || s.slot, _shift_snap(s), now() from shifts s
  where s.day >= date '2026-10-26' and s.run <> 'BU' and s.driver is not null
  on conflict (shift_key) do nothing;
