-- App error log: the driver app and owner portal record errors that happen on people's phones here (failed loads, a section that
-- could not be drawn, an unexpected crash), so problems can be seen and fixed without anyone having to report them.
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  person text,
  app text,
  kind text,
  message text,
  stack text,
  url text,
  ua text,
  detail jsonb
);
create index if not exists client_errors_at on public.client_errors (at desc);
alter table public.client_errors enable row level security;
drop policy if exists client_errors_ins on public.client_errors;
create policy client_errors_ins on public.client_errors for insert to authenticated with check (person is null or person = me());
drop policy if exists client_errors_read on public.client_errors;
create policy client_errors_read on public.client_errors for select to authenticated using (is_boss());
