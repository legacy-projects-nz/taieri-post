-- Drivers must never be stuck unable to post (26 Nov 2026, James M couldn't start his day).
-- 1) An EOD that is still missing figures can be filled in by its driver for 45 days
--    (normal edits stay same day / day after). Before this, "Before your SOD" asked drivers
--    to fix old EODs but the row-level rule silently refused the edit, so the item never cleared.
create or replace function public.eod_editable(p_shift uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from shifts s
    where s.id = p_shift
      and (
        s.day >= ((now() at time zone 'Pacific/Auckland')::date - 1)
        or (
          s.day >= ((now() at time zone 'Pacific/Auckland')::date - 45)
          and exists (
            select 1 from eod e left join runs r on r.code = s.run
            where e.shift_id = s.id
              and (e.parcels is null or e.stops is null or e.finish_time is null
                   or (r.network = 'tge' and e.sort_min is null))
          )
        )
      )
  )
$$;

-- 2) Escape hatch: a driver who can't clear "Before your SOD" can start the day anyway;
--    Jeremy gets an alert listing what was left, and the items stay in To fix.
create or replace function public.gate_skip(p_items text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare d text := (now() at time zone 'Pacific/Auckland')::date::text;
begin
  if me() is null then raise exception 'not signed in'; end if;
  insert into alerts (kind, driver, title, body, dedupe_key)
  values ('other', me(), 'Started the day with items unfixed', left(coalesce(p_items, ''), 2000), 'gateskip|' || me() || '|' || d)
  on conflict (dedupe_key) do update set body = excluded.body, created_at = now(), resolved_at = null;
end $$;
grant execute on function public.gate_skip(text) to authenticated;
