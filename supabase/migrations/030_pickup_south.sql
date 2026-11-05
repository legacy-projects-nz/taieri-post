-- Pick-ups: add South as a pick-up area
alter table public.pickups drop constraint if exists pickups_area_check;
alter table public.pickups add constraint pickups_area_check check (area in ('Rural','Owaka','Lawrence','South'));
