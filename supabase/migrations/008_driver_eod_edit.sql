-- Drivers can edit their own EOD on the day and the day after (Jeremy, 31 Oct 2026). Edits are stamped so the owner can see they changed.
-- (applied 31 Oct 2026 via execute_sql; written without DROPs so it can be re-run)
alter table public.eod add column if not exists edited_at timestamptz;
alter table public.eod add column if not exists edited_by text;

create or replace function public.eod_editable(p_shift uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from shifts s where s.id = p_shift and s.day >= ((now() at time zone 'Pacific/Auckland')::date - 1))
$$;
grant execute on function public.eod_editable(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='eod' and policyname='upd_own') then
    create policy upd_own on public.eod for update to authenticated
      using (driver = me() and eod_editable(shift_id)) with check (driver = me() and eod_editable(shift_id));
  end if;
end $$;

-- a driver's update always carries the edit stamp and can't move the row to another shift/driver or change the sent time
create or replace function public.eod_stamp_edit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not is_boss() then new.edited_at := now(); new.edited_by := me(); new.shift_id := old.shift_id; new.driver := old.driver; new.sent_at := old.sent_at; end if;
  return new;
end $$;
create or replace trigger eod_stamp_edit before update on public.eod for each row execute function public.eod_stamp_edit();
