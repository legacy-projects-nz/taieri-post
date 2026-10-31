-- 012: drivers no longer acknowledge "From Jeremy" entries; they can ask for a review instead (1 Nov 2026).
alter table public.entries add column if not exists review_requested_at timestamptz;
alter table public.entries add column if not exists review_note text;
alter table public.entries add column if not exists review_resolved_at timestamptz;
alter table public.entries add column if not exists review_resolved_by text;

create or replace function public.entry_review(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare e entries%rowtype; nm text;
begin
  select * into e from entries where id = p_id and driver = me() and show_driver;
  if e.id is null then raise exception 'not your entry'; end if;
  update entries set review_requested_at = now(), review_note = nullif(trim(p_note), ''), review_resolved_at = null, review_resolved_by = null where id = p_id;
  select split_part(name, ' ', 1) into nm from people where id = me();
  insert into alerts (kind, driver, title, body, dedupe_key)
    values ('other', me(), nm || ' asked for a review: ' || e.title, coalesce(nullif(trim(p_note), ''), 'No note given') || ' · ' || to_char(e.day, 'Dy DD Mon'), 'review|' || p_id::text)
    on conflict (dedupe_key) do update set resolved_at = null, resolved_by = null, body = excluded.body, created_at = now();
  perform log_event('review_requested', e.title);
end $$;
grant execute on function public.entry_review(uuid, text) to authenticated;
