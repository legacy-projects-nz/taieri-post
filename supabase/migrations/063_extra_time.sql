-- "+ Hours": extra work a driver logs from the driver app, beside the unpaid break button.
--   van_clean      vehicle clean           20 min, counts straight away
--   vehicle_check  vehicle check           10 min, counts straight away
--   vehicle_maint  vehicle maintenance     minutes + note, counts straight away
--   admin          admin hours             minutes + note, counts straight away
--   owner_request  Jeremy asked for it     minutes + note (what was asked), waits for Jeremy to approve
-- Approved minutes are added to the day's expected time, so the work doesn't count against the driver's efficiency.
create table if not exists public.extra_time (
  id          uuid primary key default gen_random_uuid(),
  driver      text not null references public.people(id),
  shift_id    uuid references public.shifts(id) on delete set null,
  day         date not null,
  kind        text not null check (kind in ('van_clean','vehicle_check','vehicle_maint','admin','owner_request')),
  minutes     int  not null check (minutes > 0 and minutes <= 600),
  note        text,
  status      text not null default 'approved' check (status in ('pending','approved','declined')),
  decided_by  text references public.people(id),
  decided_at  timestamptz,
  reply       text,
  created_at  timestamptz not null default now()
);
create index if not exists extra_time_day_idx on public.extra_time (day);
create index if not exists extra_time_driver_idx on public.extra_time (driver, day);

alter table public.extra_time enable row level security;
create policy xt_read on public.extra_time for select to authenticated using (driver = me() or is_boss());
-- drivers log their own, for today or yesterday; set times for the quick ones; a note for the open ones; Jeremy's requests start pending
create policy xt_ins on public.extra_time for insert to authenticated
  with check (driver = me() and decided_by is null and day >= (now() at time zone 'Pacific/Auckland')::date - 1 and day <= (now() at time zone 'Pacific/Auckland')::date
    and (case kind when 'van_clean' then minutes = 20 when 'vehicle_check' then minutes = 10 else coalesce(btrim(note), '') <> '' end)
    and (status = case when kind = 'owner_request' then 'pending' else 'approved' end));
-- a driver can take back their own entry the same day (a mis-tap), as long as Jeremy hasn't decided it
create policy xt_del on public.extra_time for delete to authenticated
  using ((driver = me() and decided_by is null and day >= (now() at time zone 'Pacific/Auckland')::date - 1) or is_boss());
create policy xt_boss on public.extra_time for update to authenticated using (is_boss()) with check (is_boss());
create policy require_2fa_staff on public.extra_time as restrictive to authenticated using (staff_ok()) with check (staff_ok());

create or replace function public.extra_time_decide(p_id uuid, p_approve boolean, p_reply text default null)
returns public.extra_time language plpgsql security definer set search_path = public as $$
declare r public.extra_time;
begin
  if my_role() is distinct from 'owner' then raise exception 'Only Jeremy can approve added hours'; end if;
  update extra_time set status = case when p_approve then 'approved' else 'declined' end, decided_by = me(), decided_at = now(), reply = nullif(p_reply, '')
    where id = p_id returning * into r;
  if r.id is null then raise exception 'Not found'; end if;
  return r;
end $$;
revoke all on function public.extra_time_decide(uuid, boolean, text) from public, anon;
grant execute on function public.extra_time_decide(uuid, boolean, text) to authenticated;

alter publication supabase_realtime add table public.extra_time;
