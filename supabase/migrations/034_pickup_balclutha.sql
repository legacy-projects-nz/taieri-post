-- Pick-ups: add Balclutha depot as a pick-up area (NZC + Post Haste only)
alter table public.pickups drop constraint if exists pickups_area_check;
alter table public.pickups add constraint pickups_area_check check (area in ('Rural','Owaka','Lawrence','South','Balclutha'));
