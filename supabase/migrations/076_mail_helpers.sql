-- Mail tray helpers: people listed in settings rules.mailHelpers (person id -> runs) can take the mail tray photos / mark Nil for
-- other drivers' shifts on those runs (today or yesterday). Liam (LT) sorts TUA, Flyer and RAM, so he does theirs.
create or replace function public.mail_helper_ok(p_shift uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from shifts s, settings st
    where s.id = p_shift and st.key = 'rules' and coalesce(st.value -> 'mailHelpers' -> me(), '[]'::jsonb) ? s.run
      and s.day between (now() at time zone 'Pacific/Auckland')::date - 1 and (now() at time zone 'Pacific/Auckland')::date) $$;
grant execute on function public.mail_helper_ok(uuid) to authenticated;

create or replace function public.task_photo_done(p_shift uuid, p_addon text, p_path text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster')))
     and not (p_addon = 'tw_mailtrays' and mail_helper_ok(p_shift)) then raise exception 'not your shift'; end if;
  update shifts set
    task_photos = task_photos || jsonb_build_object(p_addon, coalesce(task_photos -> p_addon, '[]'::jsonb) || to_jsonb(p_path)),
    task_notes = case when nullif(btrim(p_note), '') is null then task_notes
                      else task_notes || jsonb_build_object(p_addon, concat_ws(E'\n', nullif(task_notes ->> p_addon, ''), btrim(p_note))) end,
    runsheet_photos = case when p_addon = 'tw_twrunsheet' then array_append(runsheet_photos, p_path) else runsheet_photos end,
    done = done || jsonb_build_object(p_addon, now())
  where id = p_shift;
end $$;

create or replace function public.mail_none(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and (driver = me() or has_perm('roster'))) and not mail_helper_ok(p_shift) then raise exception 'not your shift'; end if;
  update shifts set mail_stops = 0, done = done || jsonb_build_object('tw_mailtrays', now()) where id = p_shift;
end $$;

update public.settings set value = value || '{"mailHelpers": {"LT": ["TUA", "FLY", "RAM"]}}'::jsonb where key = 'rules';
