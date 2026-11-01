-- Back-up / on-call allowances: what actually happened on each Back up day.
-- The amounts are worked out from the roster (shifts run BU); this table holds Jeremy's decision per day and driver.
create table if not exists allowance_outcomes (
  day date not null,
  driver text not null,
  outcome text not null check (outcome in ('not_needed','called_in','declined')),
  note text,
  decided_by text,
  decided_at timestamptz not null default now(),
  primary key (day, driver)
);
alter table allowance_outcomes enable row level security;
create policy roster_all on allowance_outcomes for all to authenticated using (has_perm('roster')) with check (has_perm('roster'));
