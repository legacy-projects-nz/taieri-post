-- "+ Hours": add Refuel (5 min, counts straight away)
alter table public.extra_time drop constraint if exists extra_time_kind_check;
alter table public.extra_time add constraint extra_time_kind_check
  check (kind in ('van_clean','vehicle_check','refuel','vehicle_maint','admin','owner_request'));

drop policy if exists xt_ins on public.extra_time;
create policy xt_ins on public.extra_time for insert to authenticated
  with check (driver = me() and decided_by is null and day >= (now() at time zone 'Pacific/Auckland')::date - 1 and day <= (now() at time zone 'Pacific/Auckland')::date
    and (case kind when 'van_clean' then minutes = 20 when 'vehicle_check' then minutes = 10 when 'refuel' then minutes = 5 else coalesce(btrim(note), '') <> '' end)
    and (status = case when kind = 'owner_request' then 'pending' else 'approved' end));
