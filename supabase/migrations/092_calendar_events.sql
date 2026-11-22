-- Calendar events (22 Nov 2026): the owner (or admin) posts events — staff do, meetings, depot closures — that show on everyone's calendar in the driver app.
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  day date not null, day_to date, time_txt text, title text not null, note text,
  who text not null default 'all' check (who in ('all', 'nzp', 'tge')),
  created_by text references people(id), created_at timestamptz not null default now()
);
alter table calendar_events enable row level security;
create policy cal_read on calendar_events for select to authenticated using (true);
create policy cal_write on calendar_events for all to authenticated using (is_boss()) with check (is_boss());
