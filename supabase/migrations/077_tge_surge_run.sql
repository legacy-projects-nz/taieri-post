-- TGE Surge run (19 Nov 2026): extra TGE run, weekdays 08:00–14:30 like S/T, needs a van.
insert into public.runs (code, name, label, network, slots, needs_van, sort, active, windows)
values ('SG', 'TGE Surge', 'TGE Surge', 'tge', 1, true, 105, true,
  '{"Mon":[["08:00","14:30"]],"Tue":[["08:00","14:30"]],"Wed":[["08:00","14:30"]],"Thu":[["08:00","14:30"]],"Fri":[["08:00","14:30"]]}'::jsonb)
on conflict (code) do nothing;
