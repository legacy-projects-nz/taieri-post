-- Two timed tasks on one add-on (Owaka Medical pick-up + drop-off) shared one Done.
-- A rule can now carry its own done key; it falls back to the add-on id.
alter table public.timing_rules add column if not exists done_key text;
update public.timing_rules set done_key = 'owaka_drop' where id = 't8';
