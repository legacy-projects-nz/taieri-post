-- Lawrence pick-ups split in two (25 Nov 2026):
--   'Lawrence'       = Lawrence parcels picked up at the Dunedin depots on D>B
--   'Lawrence Local' = picked up in Lawrence by the Lawrence driver
alter table public.pickups drop constraint if exists pickups_area_check;
alter table public.pickups add constraint pickups_area_check
  check (area = any (array['Rural','Owaka','Owaka Rural','Owaka Town','Lawrence','Lawrence Local','South','Balclutha']));

-- existing Lawrence lines entered by anyone not on D>B that day are local Lawrence pick-ups
update public.pickups p set area = 'Lawrence Local'
where p.area = 'Lawrence'
  and not exists (select 1 from public.shifts s where s.day = p.day and s.run = 'DB' and s.driver = p.driver);
