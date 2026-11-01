create table if not exists public.access_info (id int primary key default 1 check (id = 1), body text not null default '', updated_at timestamptz default now(), updated_by text);
insert into public.access_info (id, body) values (1, '') on conflict do nothing;
alter table public.access_info enable row level security;
create policy access_read on public.access_info for select to authenticated using (_pid() is not null);
create policy access_write on public.access_info for all to authenticated using (has_perm('people'::text)) with check (has_perm('people'::text));
alter publication supabase_realtime add table public.access_info;
