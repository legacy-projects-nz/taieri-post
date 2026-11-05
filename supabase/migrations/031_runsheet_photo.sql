-- Standing tasks: an add-on row marked "always" is a task on every one of its runs, with nothing to tick on the Run Board.
alter table public.addons add column if not exists always boolean not null default false;

-- Runsheet photo: a task on every NZ Post delivery run, weekdays; the driver taps Done.
insert into public.addons (id, name, short, runs, no_saturday, minutes, task, always) values
  ('tw_twrunsheet', 'Runsheet photo', 'Runsheet', array['TUA','DB','FLY','LAW','RAM','PCB','RSB'], false, 0, true, true)
on conflict (id) do update set name = excluded.name, short = excluded.short, runs = excluded.runs, task = true, always = true;
insert into public.timing_rules (id, name, opens, closes, runs, addon, days, note, active) values
  ('twrunsheet', 'Runsheet photo', null, null, array['TUA','DB','FLY','LAW','RAM','PCB','RSB'], 'tw_twrunsheet', array[1,2,3,4,5], 'Take a photo of the completed runsheet, then tap Done.', true)
on conflict (id) do update set name = excluded.name, runs = excluded.runs, addon = excluded.addon, days = excluded.days, note = excluded.note, active = true;
