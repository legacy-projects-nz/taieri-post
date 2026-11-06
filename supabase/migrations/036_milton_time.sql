-- Milton meet time: the D>B driver sets the drop-off time each day in the app (Today's tasks / Next tasks → Milton).
-- Stored on the D>B shift and copied onto that day's LAW shift(s); it replaces the timing rule's usual 10:30 for both runs.
-- The Lawrence driver gets an in-app message to confirm, plus a push (notify type "milton_time").
alter table shifts add column if not exists milton_at time;

create or replace function set_milton_time(p_shift uuid, p_time time) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shifts; law text[]; old time; mid uuid; who text := me(); txt text;
begin
  select * into s from shifts where id = p_shift;
  if s.id is null or s.run <> 'DB' then raise exception 'not a D>B shift'; end if;
  if who is null or not (s.driver = who or has_perm('roster')) then raise exception 'not your shift'; end if;
  if p_time is null then raise exception 'pick a time'; end if;
  old := s.milton_at;
  update shifts set milton_at = p_time where id = p_shift;
  select array_agg(distinct driver) into law from shifts where day = s.day and run = 'LAW' and driver is not null;
  update shifts set milton_at = p_time where day = s.day and run = 'LAW';
  perform log_event('milton_time', format('%s D>B Milton %s (was %s) by %s', s.day, to_char(p_time, 'HH24:MI'), coalesce(to_char(old, 'HH24:MI'), 'rule time'), who));
  if law is not null and old is distinct from p_time then
    txt := format('Milton meet %s: %s is now the drop-off time. Meet the D>B driver (%s) at Milton then.',
                  to_char(s.day, 'Dy FMDD Mon'), lower(to_char(p_time, 'FMHH12:MIam')), coalesce((select name from people where id = s.driver), 'D>B'));
    insert into messages (sender, body, needs_confirm) values (who, txt, true) returning id into mid;
    insert into message_recipients (message_id, person) select mid, d from unnest(law) d where d <> who;
    if not exists (select 1 from message_recipients where message_id = mid) then delete from messages where id = mid; mid := null; end if;
  end if;
  return jsonb_build_object('message_id', mid, 'law', coalesce(to_jsonb(law), '[]'::jsonb));
end $$;
revoke execute on function set_milton_time(uuid, time) from public, anon;
grant execute on function set_milton_time(uuid, time) to authenticated;
