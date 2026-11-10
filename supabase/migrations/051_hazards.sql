-- Hazard register: address-level hazards drivers report from the app (dogs, aggressive people, driveways, ice…),
-- seeded from the West Harbour and Taieri Post risk registers. Everyone signed in can read it; drivers add; staff resolve.
create table if not exists public.hazards (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique,                          -- WH-001 etc. for rows from the paper registers
  runs        text[] not null default '{}',         -- run codes this hazard sits on (RSB, PCB, RAM…)
  area        text,                                 -- suburb / township
  address     text not null,                        -- "57 Stevenson Avenue" or "Kilgour Street (all)"
  kinds       text[] not null default '{}',         -- dog, person, access, driveway, ice, road, rail, lifting, info, other
  severity    text not null default 'medium' check (severity in ('low','medium','high')),
  rule        text,                                 -- NO-GO, CARD, GATE, WALK, WET/ICE-NO, CAUTION, INFO
  note        text,                                 -- what the hazard is
  control     text,                                 -- how we deal with it
  lat         double precision,
  lng         double precision,
  source      text,
  reported_by text references public.people(id),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text references public.people(id)
);
create index if not exists hazards_open_idx on public.hazards (resolved_at) where resolved_at is null;
create index if not exists hazards_runs_idx on public.hazards using gin (runs);

alter table public.hazards enable row level security;
create policy hazards_read on public.hazards for select to authenticated using (true);
create policy hazards_ins  on public.hazards for insert to authenticated with check (reported_by = me() or has_perm('roster'));
create policy hazards_upd  on public.hazards for update to authenticated using (has_perm('roster') or reported_by = me()) with check (has_perm('roster') or reported_by = me());
create policy hazards_del  on public.hazards for delete to authenticated using (has_perm('roster'));
create policy require_2fa_staff on public.hazards as restrictive to authenticated using (staff_ok()) with check (staff_ok());

alter publication supabase_realtime add table public.hazards;
