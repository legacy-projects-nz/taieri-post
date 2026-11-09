-- Quick van wash log: one tap in the driver app records that a van was washed (separate from the weekly vehicle check).
create table if not exists public.van_washes (
  id      uuid primary key default gen_random_uuid(),
  van     text not null references public.vans(plate),
  driver  text not null references public.people(id),
  at      timestamptz not null default now(),
  note    text
);
create index if not exists van_washes_van_at_idx on public.van_washes (van, at desc);

alter table public.van_washes enable row level security;
create policy van_washes_read on public.van_washes for select to authenticated using (true);   -- anyone signed in can see when a van was last washed
create policy van_washes_ins on public.van_washes for insert to authenticated with check (driver = me() or has_perm('fleet'));
create policy van_washes_del on public.van_washes for delete to authenticated using (driver = me() or has_perm('fleet'));
create policy require_2fa_staff on public.van_washes as restrictive to authenticated using (staff_ok()) with check (staff_ok());

alter publication supabase_realtime add table public.van_washes;
