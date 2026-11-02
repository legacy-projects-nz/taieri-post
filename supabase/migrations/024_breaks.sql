-- Driver breaks: one tap to start, one tap to end. Drivers see their own; staff see everyone's.
create table if not exists public.breaks (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  driver      text not null references public.people(id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists breaks_shift_idx on public.breaks (shift_id);
create index if not exists breaks_started_idx on public.breaks (started_at);
create unique index if not exists breaks_one_open on public.breaks (driver) where ended_at is null;   -- only one break running per driver

alter table public.breaks enable row level security;
create policy breaks_read on public.breaks for select to authenticated using (driver = me() or is_boss());
create policy breaks_staff_all on public.breaks for all to authenticated using (has_perm('roster')) with check (has_perm('roster'));
create policy require_2fa_staff on public.breaks as restrictive to authenticated using (staff_ok()) with check (staff_ok());

-- Drivers start and end breaks through these, so they can only touch their own and only on their own shift
create or replace function public.break_start(p_shift uuid) returns public.breaks language plpgsql security definer set search_path = public as $$
declare r public.breaks; m text := me();
begin
  if m is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from shifts where id = p_shift and (driver = m or trainee = m)) then raise exception 'That shift isn''t yours'; end if;
  if exists (select 1 from breaks where driver = m and ended_at is null) then raise exception 'You''re already on a break'; end if;
  insert into breaks (shift_id, driver) values (p_shift, m) returning * into r;
  return r;
end $$;

create or replace function public.break_end() returns public.breaks language plpgsql security definer set search_path = public as $$
declare r public.breaks; m text := me();
begin
  if m is null then raise exception 'Not signed in'; end if;
  update breaks set ended_at = now() where driver = m and ended_at is null returning * into r;
  if r.id is null then raise exception 'No break running'; end if;
  return r;
end $$;

revoke all on function public.break_start(uuid) from public, anon;
revoke all on function public.break_end() from public, anon;
grant execute on function public.break_start(uuid) to authenticated;
grant execute on function public.break_end() to authenticated;

alter publication supabase_realtime add table public.breaks;
