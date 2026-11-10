-- Telford mail: standing Done task on D>B every weekday (Mon–Fri), no time window.
update public.addons set always = true, no_saturday = true where id = 'telford';
insert into public.timing_rules (id, name, opens, closes, runs, addon, days, note, active)
values ('telford', 'Telford mail', null, null, array['DB'], 'telford', array[1,2,3,4,5], 'Tap Done once the Telford mail is delivered.', true)
on conflict (id) do update set runs = excluded.runs, addon = excluded.addon, days = excluded.days, note = excluded.note, active = true;
