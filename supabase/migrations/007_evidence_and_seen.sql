-- 007 (31 Oct 2026): drivers read their own efficiency corrections (minus the owner's note); drivers mark "From Jeremy" entries as viewed.
create or replace function public.my_eff_overrides()
returns table (shift_id uuid, start_at time, end_at time, parcels int, stops int, trays numeric, pickups int, pickup_parcels int, sort_min int, sorted_parcels boolean, sorted_mail boolean, nzc_ph boolean, legs text[], news_min int, train_day boolean, train_min int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.shift_id, o.start_at, o.end_at, o.parcels, o.stops, o.trays, o.pickups, o.pickup_parcels, o.sort_min, o.sorted_parcels, o.sorted_mail, o.nzc_ph, o.legs, o.news_min, o.train_day, o.train_min, o.updated_at
  from eff_overrides o join shifts s on s.id = o.shift_id where s.driver = _pid() $$;
revoke execute on function public.my_eff_overrides() from public, anon;
grant execute on function public.my_eff_overrides() to authenticated;

alter table public.entries add column if not exists seen_at timestamptz;
create or replace function public.entry_seen(p_id uuid) returns void language sql security definer set search_path = public as $$
  update entries set seen_at = now() where id = p_id and driver = _pid() and show_driver and seen_at is null $$;
revoke execute on function public.entry_seen(uuid) from public, anon;
grant execute on function public.entry_seen(uuid) to authenticated;
