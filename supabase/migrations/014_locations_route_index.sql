-- 014: indexes so the Routes tab can load a day's saved GPS trails quickly (1 Nov 2026).
create index if not exists idx_locations_at on public.locations (at);
create index if not exists idx_locations_shift_at on public.locations (shift_id, at);
