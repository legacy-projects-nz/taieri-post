create table if not exists public.pickups (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  area text not null check (area in ('Rural','Owaka','Lawrence')),
  customer text not null check (customer in ('NZC','PH','TGE')),
  small int not null default 0 check (small >= 0),
  large int not null default 0 check (large >= 0),
  note text, driver text, created_by text, created_at timestamptz default now()
);
create index if not exists pickups_day_idx on public.pickups (day);
alter table public.pickups enable row level security;
create policy pickups_staff_all on public.pickups for all to authenticated using (has_perm('roster'::text)) with check (has_perm('roster'::text));
create policy pickups_driver_read on public.pickups for select to authenticated using (driver = me());
create policy pickups_driver_ins on public.pickups for insert to authenticated with check (driver = me() and created_by = me());
alter publication supabase_realtime add table public.pickups;
