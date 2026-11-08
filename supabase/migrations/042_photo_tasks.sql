-- Photo tasks: any add-on with photo = true gets a "Take photo" button; the photo is stored and the task ticked.
alter table public.addons add column if not exists photo boolean not null default false;
alter table public.shifts add column if not exists task_photos jsonb not null default '{}';
update public.addons set photo = true where id = 'tw_twrunsheet';

-- Lawrence: mail tray photo, Mon / Wed / Fri (mail days), standing task on the LAW run
insert into public.addons (id, name, short, runs, no_saturday, minutes, task, always, photo) values
  ('tw_lawtrays', 'Mail tray photo', 'Mail trays', array['LAW'], true, 0, true, true, true)
on conflict (id) do update set name = excluded.name, short = excluded.short, runs = excluded.runs, task = true, always = true, photo = true;
insert into public.timing_rules (id, name, opens, closes, runs, addon, days, note, active) values
  ('lawtrays', 'Mail tray photo', null, null, array['LAW'], 'tw_lawtrays', array[1,3,5], 'Tap Take photo and photograph the mail trays. That ticks it off.', true)
on conflict (id) do update set name = excluded.name, runs = excluded.runs, addon = excluded.addon, days = excluded.days, note = excluded.note, active = true;

create or replace function public.task_photo_done(p_shift uuid, p_addon text, p_path text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  update shifts set
    task_photos = task_photos || jsonb_build_object(p_addon, coalesce(task_photos -> p_addon, '[]'::jsonb) || to_jsonb(p_path)),
    runsheet_photos = case when p_addon = 'tw_twrunsheet' then array_append(runsheet_photos, p_path) else runsheet_photos end,
    done = done || jsonb_build_object(p_addon, now())
  where id = p_shift;
end $$;
grant execute on function public.task_photo_done(uuid, text, text) to authenticated;
