-- Drivers can fix their own pick-up totals (counts, note, or delete the line) on the day only (NZ date).
-- Owner / admins with 'roster' keep full edit access through pickups_staff_all.
drop policy if exists pickups_driver_upd on public.pickups;
create policy pickups_driver_upd on public.pickups for update to authenticated
  using (driver = me() and day = (now() at time zone 'Pacific/Auckland')::date)
  with check (driver = me() and day = (now() at time zone 'Pacific/Auckland')::date);

drop policy if exists pickups_driver_del on public.pickups;
create policy pickups_driver_del on public.pickups for delete to authenticated
  using (driver = me() and day = (now() at time zone 'Pacific/Auckland')::date);
