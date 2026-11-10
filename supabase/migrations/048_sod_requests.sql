-- Start-time sign-off: a SOD posted more than 20 min before (early) or after (late) the rostered start still goes in straight away,
-- but sends Jeremy a request. When he approves, that driver's shifts for the day move by the same amount (start and end),
-- so the roster matches the real start. Until then, an early start is paid from the rostered start.
create table if not exists public.sod_requests (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null unique references public.shifts(id) on delete cascade,   -- the SOD's shift (first of the day)
  driver      text not null references public.people(id),
  day         date not null,
  kind        text not null check (kind in ('early','late')),
  rostered    time not null,                 -- rostered start of the day when the SOD went in
  started     time not null,                 -- SOD time
  delta_min   int not null,                  -- started − rostered (negative = early)
  moves       jsonb not null default '[]',   -- [{shift_id, start_at, end_at}] the new times for each shift that day
  note        text,
  status      text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by  text references public.people(id),
  decided_at  timestamptz,
  reply       text,
  created_at  timestamptz not null default now()
);
create index if not exists sod_requests_day_idx on public.sod_requests (day);

alter table public.sod_requests enable row level security;
create policy sodreq_read on public.sod_requests for select to authenticated using (driver = me() or is_boss());
create policy sodreq_ins on public.sod_requests for insert to authenticated
  with check (driver = me() and status = 'pending' and decided_by is null
              and exists (select 1 from shifts s where s.id = shift_id and (s.driver = me() or s.trainee = me())));
-- driver can add/change the note while it's still waiting
create policy sodreq_note on public.sod_requests for update to authenticated
  using (driver = me() and status = 'pending') with check (driver = me() and status = 'pending' and decided_by is null);
create policy require_2fa_staff on public.sod_requests as restrictive to authenticated using (staff_ok()) with check (staff_ok());

-- Jeremy (owner) decides. Approving moves each listed shift to its new times and keeps the "sent" roster snapshot in step,
-- so the Run Board doesn't show it as an unsent change.
create or replace function public.sod_request_decide(p_id uuid, p_approve boolean, p_reply text default null)
returns public.sod_requests language plpgsql security definer set search_path = public as $$
declare r public.sod_requests; m jsonb; s public.shifts;
begin
  if my_role() is distinct from 'owner' then raise exception 'Only Jeremy can sign off start times'; end if;
  select * into r from sod_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Already %', r.status; end if;
  if p_approve then
    for m in select * from jsonb_array_elements(r.moves) loop
      s := null;
      update shifts set start_at = (m->>'start_at')::time, end_at = (m->>'end_at')::time
        where id = (m->>'shift_id')::uuid and driver = r.driver returning * into s;
      if s.id is not null then
        update roster_sent set snapshot = snapshot || jsonb_build_object('start_at', left(m->>'start_at', 5), 'end_at', left(m->>'end_at', 5))
          where shift_key = s.day || '|' || s.run || '|' || s.slot and snapshot ? 'driver';
      end if;
    end loop;
  end if;
  update sod_requests set status = case when p_approve then 'approved' else 'declined' end, decided_by = me(), decided_at = now(), reply = nullif(p_reply, '')
    where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.sod_request_decide(uuid, boolean, text) from public, anon;
grant execute on function public.sod_request_decide(uuid, boolean, text) to authenticated;

alter publication supabase_realtime add table public.sod_requests;
