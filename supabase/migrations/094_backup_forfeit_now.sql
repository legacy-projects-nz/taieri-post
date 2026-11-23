-- Back-up used = allowance forfeited, decided as soon as it happens (not only after the back-up window ends).
-- "Not needed" (allowance owed) still waits for the window to end.
create or replace function public.auto_allowances() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  with nz as (select (now() at time zone 'Pacific/Auckland') as ts),
  cand as (
    select bu.day, bu.driver,
      (exists (
        select 1 from roster_change_items i join roster_changes c on c.id = i.change_id
        where c.status = 'sent' and i.day = bu.day and i.run <> 'BU' and i.after->>'driver' = bu.driver
          and coalesce(i.before->>'driver', '') <> bu.driver
          and (c.sent_at at time zone 'Pacific/Auckland') >= (bu.day - 1) + time '17:00'
      ) or exists (select 1 from sod o where o.shift_id = bu.id)) as used,
      (bu.day < nz.ts::date or (bu.day = nz.ts::date and nz.ts::time > coalesce(bu.end_at, '18:00'::time))) as over
    from shifts bu, nz
    where bu.run = 'BU' and bu.driver is not null and bu.day <= nz.ts::date
  ),
  due as (select day, driver, case when used then 'called_in' else 'not_needed' end as outcome from cand where used or over)
  insert into allowance_outcomes (day, driver, outcome, note, decided_by, decided_at)
  select day, driver, outcome, 'auto', null, now() from due
  on conflict (day, driver) do update set outcome = excluded.outcome, decided_at = now()
    where allowance_outcomes.note = 'auto' and allowance_outcomes.outcome is distinct from excluded.outcome;
  get diagnostics n = row_count; return n;
end $function$;
