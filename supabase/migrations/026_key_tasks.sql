-- Sort-shift "pick up the key" tasks (applied live 3 Nov 2026).
-- Street receiver key: whoever has Roseneath / Sawyers Bay / Port Chalmers receiver ticked (Mon–Fri).
-- Airport keys: whoever has Airport ticked.
-- The task goes on that driver's first sort shift (SUP*) that day, or on the run itself if they have no sort,
-- and moves automatically whenever the roster or ticks change.
insert into addons (id, name, short, runs, no_saturday, minutes, task) values
  ('tw_twrcvkey', 'Pick up street receiver key', 'Receiver key', array['SUP','SUP2','SUP3','RSB','PCB','WH'], false, 0, true),
  ('tw_twairkeys', 'Pick up airport keys', 'Airport keys', array['SUP','SUP2','SUP3','TUA','FLY','RAM'], false, 0, true)
on conflict (id) do update set name = excluded.name, short = excluded.short, runs = excluded.runs, task = true;

insert into timing_rules (id, name, opens, closes, runs, addon, days, note, active) values
  ('twrcvkey', 'Pick up street receiver key', null, null, array['SUP','SUP2','SUP3','RSB','PCB','WH'], 'tw_twrcvkey', array[1,2,3,4,5],
   'You''re on the receivers today: grab the street receiver key during the sort, before you head out. Tap Done once you have it.', true),
  ('twairkeys', 'Pick up airport keys', null, null, array['SUP','SUP2','SUP3','TUA','FLY','RAM'], 'tw_twairkeys', array[1,2,3,4,5,6,7],
   'You''re doing the airport today: grab the airport keys during the sort, before you head out. Tap Done once you have them.', true)
on conflict (id) do update set name = excluded.name, runs = excluded.runs, addon = excluded.addon, days = excluded.days, note = excluded.note, active = true;

create or replace function public.sync_key_task(p_day date, p_key text, p_on text[]) returns void language plpgsql security definer set search_path = public as $$
begin
  with who as (select distinct driver from shifts where day = p_day and coalesce(addons,'{}') && p_on),
  target as (
    select distinct on (s.driver) s.id from shifts s join who w on w.driver = s.driver
    where s.day = p_day and (s.run ~ '^SUP' or coalesce(s.addons,'{}') && p_on)
    order by s.driver, (s.run ~ '^SUP') desc, s.start_at nulls last, s.run)
  update shifts s set addons = case when s.id in (select id from target)
      then array_append(array_remove(coalesce(s.addons,'{}'), p_key), p_key)
      else array_remove(coalesce(s.addons,'{}'), p_key) end
  where s.day = p_day and ((s.id in (select id from target)) <> (p_key = any(coalesce(s.addons,'{}'))));
end $$;

create or replace function public.sync_key_tasks(p_day date) returns void language plpgsql security definer set search_path = public as $$
begin
  perform sync_key_task(p_day, 'tw_twrcvkey', array['rose','sb','pc']);
  perform sync_key_task(p_day, 'tw_twairkeys', array['airport']);
end $$;

create or replace function public.trg_sync_key_tasks() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op in ('INSERT','UPDATE') then perform sync_key_tasks(new.day); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.day is distinct from new.day) then perform sync_key_tasks(old.day); end if;
  return null;
end $$;

create trigger shifts_key_tasks after insert or update of addons, driver, day, run or delete on shifts
  for each row execute function trg_sync_key_tasks();
