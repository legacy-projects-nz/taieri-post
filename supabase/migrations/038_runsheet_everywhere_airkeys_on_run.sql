-- 1. Runsheet photo is a standing task on every NZ Post run, Mon–Sat, to be done before the EOD (the EOD form asks for it).
--    It never needs ticking on a shift, so any manual ticks are cleared.
update addons set runs = array['TUA','DB','FLY','LAW','RAM','PCB','RSB','WH'], always = true, task = true, no_saturday = false where id = 'tw_twrunsheet';
update timing_rules set runs = array['TUA','DB','FLY','LAW','RAM','PCB','RSB','WH'], days = array[1,2,3,4,5,6], active = true,
  note = 'Before you send your EOD: take a photo of the completed runsheet, then tap Done. The EOD form asks for it.'
  where id = 'twrunsheet';
update shifts set addons = array_remove(addons, 'tw_twrunsheet') where 'tw_twrunsheet' = any(addons);

-- 2. Airport keys sit on the airport run itself (TUA / FLY / RAM with Airport ticked), not on the driver's sort shift,
--    so the airport driver sees them on the run and ticking them there sticks. The street receiver key stays on the sort.
drop function if exists public.sync_key_task(date, text, text[]);
create or replace function public.sync_key_task(p_day date, p_key text, p_on text[], p_sort_first boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  with who as (select distinct driver from shifts where day = p_day and coalesce(addons,'{}') && p_on),
  target as (
    select distinct on (s.driver) s.id from shifts s join who w on w.driver = s.driver
    where s.day = p_day and (s.run ~ '^SUP' or coalesce(s.addons,'{}') && p_on)
    order by s.driver, (case when p_sort_first then (s.run ~ '^SUP') else (coalesce(s.addons,'{}') && p_on) end) desc, s.start_at nulls last, s.run)
  update shifts s set addons = case when s.id in (select id from target)
      then array_append(array_remove(coalesce(s.addons,'{}'), p_key), p_key)
      else array_remove(coalesce(s.addons,'{}'), p_key) end
  where s.day = p_day and ((s.id in (select id from target)) <> (p_key = any(coalesce(s.addons,'{}'))));
end $$;

create or replace function public.sync_key_tasks(p_day date) returns void language plpgsql security definer set search_path = public as $$
begin
  perform sync_key_task(p_day, 'tw_twrcvkey', array['rose','sb','pc'], true);
  perform sync_key_task(p_day, 'tw_twairkeys', array['airport'], false);
end $$;

update timing_rules set note = 'You''re doing the airport today: pick up the airport keys at the depot before you head out. Tap Done once you have them.' where id = 'twairkeys';

-- re-place the keys on every day from today (NZ) forward
select sync_key_tasks(d::date) from generate_series((now() at time zone 'Pacific/Auckland')::date, (now() at time zone 'Pacific/Auckland')::date + 60, interval '1 day') d;
