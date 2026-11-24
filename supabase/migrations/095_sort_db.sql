-- Run Board: a "Sort – D>B" row (SUP4), Mon–Fri 6–7am, no van. In the driver app a D>B run straight after it has no sort of its own.
insert into runs (code, name, label, network, slots, needs_van, sort, active, windows) values ('SUP4', 'NZP depot · D>B', 'Sort – D>B', 'nzp', 1, false, 175, true,
  '{"Mon":[["06:00","07:00"]],"Tue":[["06:00","07:00"]],"Wed":[["06:00","07:00"]],"Thu":[["06:00","07:00"]],"Fri":[["06:00","07:00"]]}'::jsonb)
on conflict (code) do nothing;
