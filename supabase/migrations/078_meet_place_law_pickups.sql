-- Meet-up place (20 Nov 2026): the D>B driver picks Milton or Balclutha plus a time each day, and the Lawrence driver gets it.
-- Stored on the D>B shift and copied onto that day's LAW shift(s), next to milton_at (the meet time).
alter table shifts add column if not exists meet_place text;
alter table shifts drop constraint if exists shifts_meet_place_chk;
alter table shifts add constraint shifts_meet_place_chk check (meet_place is null or meet_place in ('Milton', 'Balclutha'));

create or replace function set_meet(p_shift uuid, p_time time, p_place text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shifts; law text[]; old_t time; old_p text; mid uuid; who text := me(); txt text; pl text := coalesce(nullif(p_place, ''), 'Milton');
begin
  select * into s from shifts where id = p_shift;
  if s.id is null or s.run <> 'DB' then raise exception 'not a D>B shift'; end if;
  if who is null or not (s.driver = who or has_perm('roster')) then raise exception 'not your shift'; end if;
  if p_time is null then raise exception 'pick a time'; end if;
  if pl not in ('Milton', 'Balclutha') then raise exception 'pick Milton or Balclutha'; end if;
  old_t := s.milton_at; old_p := coalesce(s.meet_place, 'Milton');
  update shifts set milton_at = p_time, meet_place = pl where id = p_shift;
  select array_agg(distinct driver) into law from shifts where day = s.day and run = 'LAW' and driver is not null;
  update shifts set milton_at = p_time, meet_place = pl where day = s.day and run = 'LAW';
  perform log_event('milton_time', format('%s D>B meet %s %s (was %s %s) by %s', s.day, pl, to_char(p_time, 'HH24:MI'), old_p, coalesce(to_char(old_t, 'HH24:MI'), 'rule time'), who));
  if law is not null and (old_t is distinct from p_time or old_p is distinct from pl) then
    txt := format('Meet-up %s: %s at %s. Meet %s (D>B) there.',
                  to_char(s.day, 'Dy FMDD Mon'), pl, lower(to_char(p_time, 'FMHH12:MIam')), coalesce((select split_part(name, ' ', 1) from people where id = s.driver), 'the D>B driver'));
    insert into messages (sender, body, needs_confirm) values (who, txt, true) returning id into mid;
    insert into message_recipients (message_id, person) select mid, d from unnest(law) d where d <> who;
    if not exists (select 1 from message_recipients where message_id = mid) then delete from messages where id = mid; mid := null; end if;
  end if;
  return jsonb_build_object('message_id', mid, 'law', coalesce(to_jsonb(law), '[]'::jsonb), 'place', pl);
end $$;
revoke execute on function set_meet(uuid, time, text) from public, anon;
grant execute on function set_meet(uuid, time, text) to authenticated;

-- old entry point keeps working: same place as before (Milton if none set)
create or replace function set_milton_time(p_shift uuid, p_time time) returns jsonb
language sql security definer set search_path = public as $$
  select set_meet(p_shift, p_time, coalesce((select meet_place from shifts where id = p_shift), 'Milton'));
$$;

-- Lawrence pick-ups the D>B driver brought in that morning (Post Haste + NZ Couriers), for the Lawrence driver to see.
-- Drivers can only read their own pick-up lines, so this hands the LAW driver just the totals.
create or replace function law_pickups(p_day date) returns table (customer text, small int, large int, logged_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if me() is null or not (has_perm('roster') or exists (select 1 from shifts where day = p_day and run in ('LAW', 'DB') and (driver = me() or trainee = me())))
    then raise exception 'not on Lawrence that day'; end if;
  return query
    select p.customer, sum(p.small)::int, sum(p.large)::int, max(p.created_at)
    from pickups p
    where p.day = p_day and p.area = 'Lawrence' and p.min_fee is null and p.customer in ('PH', 'NZC')
      and p.driver in (select driver from shifts where day = p_day and run = 'DB' and driver is not null)
    group by p.customer;
end $$;
revoke execute on function law_pickups(date) from public, anon;
grant execute on function law_pickups(date) to authenticated;

update timing_rules set name = 'Meet-up with D>B', short = 'Meet-up', note = 'Meet the D>B driver at Milton at 10:30' where id = 't10';
update timing_rules set name = 'Meet-up with LAW', short = 'Meet-up', note = 'Meet the Lawrence (LAW) driver at Milton at 10:30' where id = 't9';
