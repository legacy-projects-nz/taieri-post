-- Drivers confirm ("read") each hazard on their runs. A confirmation lapses after 30 days, or when the hazard is changed,
-- so hazards come back monthly and for any driver who hasn't confirmed them yet (e.g. new to the run).
alter table public.hazards add column if not exists updated_at timestamptz not null default now();
create or replace function public.hazards_touch() returns trigger language plpgsql as $$
begin
  if (new.address, new.kinds, new.severity, new.rule, new.note, new.control) is distinct from (old.address, old.kinds, old.severity, old.rule, old.note, old.control)
  then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists hazards_touch on public.hazards;
create trigger hazards_touch before update on public.hazards for each row execute function public.hazards_touch();

create table if not exists public.hazard_acks (
  hazard_id uuid not null references public.hazards(id) on delete cascade,
  driver    text not null references public.people(id),
  acked_at  timestamptz not null default now(),
  primary key (hazard_id, driver)
);
alter table public.hazard_acks enable row level security;
create policy hazard_acks_read on public.hazard_acks for select to authenticated using (driver = me() or has_perm('roster'));
create policy hazard_acks_ins  on public.hazard_acks for insert to authenticated with check (driver = me());
create policy hazard_acks_upd  on public.hazard_acks for update to authenticated using (driver = me()) with check (driver = me());
create policy require_2fa_staff on public.hazard_acks as restrictive to authenticated using (staff_ok()) with check (staff_ok());
alter publication supabase_realtime add table public.hazard_acks;
