-- Pick-up entry tasks: a task with pu_area set gets an "Enter pick-ups" button in the driver app
-- that opens the pick-ups sheet on that area; saving it marks the task done.
alter table public.addons add column if not exists pu_area text;

-- Sort (5am NZP Rural sort): the existing NZC/PH Pick Up task opens Rural pick-ups
update public.addons set pu_area = 'Rural' where id = 'tw_twnzcph';

-- D>B: three standing pick-up tasks every weekday (TGE South, Owaka, Lawrence); Outram: Rural
insert into public.addons (id, name, short, runs, no_saturday, minutes, task, always, pu_area) values
  ('tw_pusouth', 'Pick-ups: TGE South', 'PU South', array['DB'],  true, 0, true, true, 'South'),
  ('tw_puowaka', 'Pick-ups: Owaka',     'PU Owaka', array['DB'],  true, 0, true, true, 'Owaka'),
  ('tw_pulaw',   'Pick-ups: Lawrence',  'PU LAW',   array['DB'],  true, 0, true, true, 'Lawrence'),
  ('tw_purural', 'Pick-ups: Rural',     'PU Rural', array['RAM'], true, 0, true, true, 'Rural')
on conflict (id) do update set name = excluded.name, short = excluded.short, runs = excluded.runs, task = true, always = true, pu_area = excluded.pu_area;

insert into public.timing_rules (id, name, opens, closes, runs, addon, days, note, active) values
  ('pusouth', 'Pick-ups: TGE South', null, null, array['DB'],  'tw_pusouth', array[1,2,3,4,5], 'Tap Enter pick-ups and put in today''s TGE South pick-ups. No pick-ups today? Tap None.', true),
  ('puowaka', 'Pick-ups: Owaka',     null, null, array['DB'],  'tw_puowaka', array[1,2,3,4,5], 'Tap Enter pick-ups and put in today''s Owaka pick-ups. No pick-ups today? Tap None.', true),
  ('pulaw',   'Pick-ups: Lawrence',  null, null, array['DB'],  'tw_pulaw',   array[1,2,3,4,5], 'Tap Enter pick-ups and put in today''s Lawrence pick-ups. No pick-ups today? Tap None.', true),
  ('purural', 'Pick-ups: Rural',     null, null, array['RAM'], 'tw_purural', array[1,2,3,4,5], 'Tap Enter pick-ups and put in today''s Rural pick-ups. No pick-ups today? Tap None.', true)
on conflict (id) do update set name = excluded.name, runs = excluded.runs, addon = excluded.addon, days = excluded.days, note = excluded.note, active = true;

update public.timing_rules set note = 'Tap Enter pick-ups and put in the Rural NZC / Post Haste pick-ups at the start of the day. None today? Tap None.' where id = 'twnzcph';
