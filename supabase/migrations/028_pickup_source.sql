-- Pick-ups: split counts by where they were picked up — at the depot or from the customer.
-- Existing rows are treated as depot pick-ups.
alter table public.pickups add column if not exists source text not null default 'depot';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pickups_source_chk') then
    alter table public.pickups add constraint pickups_source_chk check (source in ('depot','customer'));
  end if;
end $$;
