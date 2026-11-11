-- Photo tasks can ask for notes: addons.photo_note = true makes the driver app ask for a note with the photo.
-- Notes are kept per task on the shift (shifts.task_notes, addon id -> text) and shown with the photo on the admin task sheet.
alter table public.addons add column if not exists photo_note boolean not null default false;
alter table public.shifts add column if not exists task_notes jsonb not null default '{}';

-- Lawrence: daily bay photo with notes, Mon–Fri, standing task on the LAW run
insert into public.addons (id, name, short, runs, no_saturday, minutes, task, always, photo, photo_note) values
  ('tw_lawbay', 'Bay photo', 'Bay', array['LAW'], true, 0, true, true, true, true)
on conflict (id) do update set name = excluded.name, short = excluded.short, runs = excluded.runs, task = true, always = true, photo = true, photo_note = true;
insert into public.timing_rules (id, name, opens, closes, runs, addon, days, note, active) values
  ('lawbay', 'Bay photo', null, null, array['LAW'], 'tw_lawbay', array[1,2,3,4,5], 'Tap Take photo, photograph the bay and add your notes. That ticks it off.', true)
on conflict (id) do update set name = excluded.name, runs = excluded.runs, addon = excluded.addon, days = excluded.days, note = excluded.note, active = true;

drop function if exists public.task_photo_done(uuid, text, text);
create or replace function public.task_photo_done(p_shift uuid, p_addon text, p_path text, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set
    task_photos = task_photos || jsonb_build_object(p_addon, coalesce(task_photos -> p_addon, '[]'::jsonb) || to_jsonb(p_path)),
    task_notes = case when nullif(btrim(p_note), '') is null then task_notes
                      else task_notes || jsonb_build_object(p_addon, concat_ws(E'\n', nullif(task_notes ->> p_addon, ''), btrim(p_note))) end,
    runsheet_photos = case when p_addon = 'tw_twrunsheet' then array_append(runsheet_photos, p_path) else runsheet_photos end,
    done = done || jsonb_build_object(p_addon, now())
  where id = p_shift;
end $$;
grant execute on function public.task_photo_done(uuid, text, text, text) to authenticated;

-- Lawrence mail tray photo: every weekday now (was Mon / Wed / Fri)
update public.timing_rules set days = array[1,2,3,4,5], active = true where id = 'lawtrays';
