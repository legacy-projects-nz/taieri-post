-- NZ Post runs (TUA, FLY, RAM, LAW, RSB, PCB, WH): scanner total + mail tray photo → TDT and the driver's day estimate (18 Nov 2026)
--  * Runsheet photo now asks for the scanner's parcel total (shifts.scan_parcels).
--  * Stops are no longer asked for on these runs: 80% of the parcel total (rules.stopRatio).
--  * New morning task "Mail tray photo" (up to 3 photos). The photos are counted (tray slots with mail = mail stops) by the
--    mailcount edge function; the driver confirms or corrects the count (shifts.mail_stops, AI result in shifts.mail_ai).
--  * TDT: mail stops × minutes per mail stop (rural TUA/FLY/RAM 0.25 min, town LAW/RSB/PCB/WH 0.6 min) in place of the tray term;
--    run bases re-set so the median past run comes out at 90% efficiency (TDT ÷ 0.9 = expected time).

alter table public.shifts add column if not exists scan_parcels integer;
alter table public.shifts add column if not exists mail_stops integer;
alter table public.shifts add column if not exists mail_ai jsonb;
alter table public.eod add column if not exists mail_stops integer;
alter table public.eff_overrides add column if not exists mail_stops integer;

-- driver (or roster admin) sets the day's scanner total / mail stops on their shift
create or replace function public.set_run_figs(p_shift uuid, p_scan integer default null, p_mail integer default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) then raise exception 'not your shift'; end if;
  if p_scan is not null and (p_scan < 0 or p_scan > 2000) then raise exception 'scanner total looks wrong'; end if;
  if p_mail is not null and (p_mail < 0 or p_mail > 2000) then raise exception 'mail stops look wrong'; end if;
  update shifts set scan_parcels = coalesce(p_scan, scan_parcels), mail_stops = coalesce(p_mail, mail_stops) where id = p_shift;
end $$;
grant execute on function public.set_run_figs(uuid, integer, integer) to authenticated;

-- Standing tasks can start on a set date (not carried over / listed as undone before it)
alter table public.addons add column if not exists since date;

-- Mail tray photo: standing morning task. Rural runs + Lawrence Mon–Fri; West Harbour runs on their mail days (Tue / Thu / Sat)
insert into public.addons (id, name, short, runs, no_saturday, minutes, task, always, photo, photo_note) values
  ('tw_mailtrays', 'Mail tray photo', 'Mail trays', array['TUA','FLY','RAM','LAW','PCB','RSB','WH'], false, 0, true, true, true, false)
on conflict (id) do update set name = excluded.name, short = excluded.short, runs = excluded.runs, no_saturday = false, task = true, always = true, photo = true;
update public.addons set since = '2026-11-19' where id = 'tw_mailtrays';   -- starts tomorrow: nothing owed for earlier days
insert into public.timing_rules (id, name, opens, closes, runs, addon, days, note, active) values
  ('mailtrays', 'Mail tray photo', null, null, array['TUA','FLY','RAM','LAW'], 'tw_mailtrays', array[1,2,3,4,5], 'Photograph your mail trays (up to 3 photos) before you head out. The slots with mail are counted for your mail stops.', true),
  ('mailtrays_wh', 'Mail tray photo', null, null, array['PCB','RSB','WH'], 'tw_mailtrays', array[2,4,6], 'Photograph your mail trays (up to 3 photos) before you head out. The slots with mail are counted for your mail stops.', true)
on conflict (id) do update set name = excluded.name, runs = excluded.runs, addon = excluded.addon, days = excluded.days, note = excluded.note, active = true;
-- the old Lawrence-only tray photo is replaced by the new task
update public.timing_rules set active = false where id = 'lawtrays';

-- TDT settings
update public.settings set value = value || jsonb_build_object('mailRuns', jsonb_build_array('TUA','FLY','RAM','LAW','RSB','PCB','WH'), 'stopRatio', 0.8, 'mailPerTray', 75, 'estEff', 0.9) where key = 'rules';
update public.settings set value = value || '{
  "TUA": {"net": "nzp", "base": 106, "legs": 1, "news": 1, "stop": 1.5, "tray": 0, "addon": 4, "parcel": 0.5, "pickup": 0, "mail": 0.25},
  "FLY": {"net": "nzp", "base": 76, "legs": 1, "news": 1, "stop": 1.5, "tray": 0, "addon": 25, "parcel": 0.5, "pickup": 0, "mail": 0.25},
  "RAM": {"net": "nzp", "base": 53, "news": 1, "stop": 1.2, "tray": 0, "parcel": 0.6, "pickup": 0, "mail": 0.25},
  "LAW": {"net": "nzp", "base": 50, "stop": 1.75, "tray": 0, "addon": 45, "parcel": 0, "pickup": 2, "mail": 0.6},
  "RSB": {"net": "nzp", "base": 76, "stop": 1.5, "tray": 0, "floor": 225, "parcel": 0.35, "pickup": 0, "mail": 0.6},
  "PCB": {"net": "nzp", "base": 105, "stop": 1.5, "tray": 0, "floor": 225, "parcel": 0.35, "pickup": 0, "mail": 0.6},
  "WH":  {"net": "nzp", "base": 175, "stop": 1.5, "tray": 0, "parcel": 0.35, "pickup": 0, "mail": 0.6}
}'::jsonb where key = 'effSimple';
