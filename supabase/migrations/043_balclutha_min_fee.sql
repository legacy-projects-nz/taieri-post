-- Balclutha depot: "None – split fee" entry. A pick-up row with min_fee set is a no-parcel day charged at that amount
-- (one row each for NZC and Post Haste, $2.50 each). The D>B Balclutha depot pick-up task gets the Enter pick-ups button.
alter table public.pickups add column if not exists min_fee numeric;
update public.addons set pu_area = 'Balclutha' where id = 'balclutha';
