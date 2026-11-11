-- Allowances fill themselves in. Once a Back up (BU) slot's window is over, it gets an outcome automatically:
--   a roster change moved a run onto that person, sent after 5pm the day before or on the day -> called_in (paid for hours worked, no allowance)
--   nothing was changed to them                                    -> not_needed (allowance owed)
-- Auto outcomes are marked note = 'auto' and keep updating if the roster changes; one Jeremy sets by hand (note not 'auto') is never touched.
create or replace function public.auto_allowances() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with nz as (select (now() at time zone 'Pacific/Auckland') as ts),
  due as (
    select bu.day, bu.driver,
      case when exists (
        select 1 from roster_change_items i join roster_changes c on c.id = i.change_id
        where c.status = 'sent' and i.day = bu.day and i.run <> 'BU' and i.after->>'driver' = bu.driver
          and coalesce(i.before->>'driver', '') <> bu.driver
          and (c.sent_at at time zone 'Pacific/Auckland') >= (bu.day - 1) + time '17:00'
      ) then 'called_in' else 'not_needed' end as outcome
    from shifts bu, nz
    where bu.run = 'BU' and bu.driver is not null and bu.day >= '2026-11-02'
      and (bu.day < nz.ts::date or (bu.day = nz.ts::date and nz.ts::time > coalesce(bu.end_at, '18:00'::time)))
  )
  insert into allowance_outcomes (day, driver, outcome, note, decided_by, decided_at)
  select day, driver, outcome, 'auto', null, now() from due
  on conflict (day, driver) do update set outcome = excluded.outcome, decided_at = now()
    where allowance_outcomes.note = 'auto' and allowance_outcomes.outcome is distinct from excluded.outcome;
  get diagnostics n = row_count; return n;
end $$;

revoke all on function public.auto_allowances() from public, anon, authenticated;

select cron.schedule('auto-allowances', '*/15 * * * *', $$ select public.auto_allowances() $$);
