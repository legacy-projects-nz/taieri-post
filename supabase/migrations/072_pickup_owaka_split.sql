-- Owaka pick-ups split into Owaka Rural and Owaka Town (18 Nov 2026). "Owaka" kept for older entries.
alter table public.pickups drop constraint if exists pickups_area_check;
alter table public.pickups add constraint pickups_area_check check (area in ('Rural','Owaka','Owaka Rural','Owaka Town','Lawrence','South','Balclutha'));
update public.addons set name = 'Owaka Rural', short = 'Owaka Rural', pu_area = 'Owaka Rural' where id = 'tw_puowaka';
insert into public.addons (id, name, runs, no_saturday, minutes, task, short, always, pu_area, photo, photo_note)
values ('tw_puowakatown', 'Owaka Town', array['DB'], true, 0, true, 'Owaka Town', true, 'Owaka Town', false, false)
on conflict (id) do nothing;
update public.timing_rules set name = 'Owaka Rural', short = 'Owaka Rural PU', note = 'Tap Enter pick-ups and put in today''s Owaka Rural pick-ups. No pick-ups today? Tap None.' where id = 'puowaka';
insert into public.timing_rules (id, name, opens, closes, runs, addon, days, note, active, done_key, short, code)
values ('puowakatown', 'Owaka Town', null, null, array['DB'], 'tw_puowakatown', array[1,2,3,4,5], 'Tap Enter pick-ups and put in today''s Owaka Town pick-ups. No pick-ups today? Tap None.', true, null, 'Owaka Town PU', null)
on conflict (id) do nothing;
