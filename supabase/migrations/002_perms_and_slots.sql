-- Applied 30 Oct 2026 (after Jeremy ran: alter table shifts drop constraint shifts_day_run_key;)
-- Per-area permissions: the owner can add staff and tick which areas they get.
-- Areas: roster, roster_approve, scorecard, alerts, messages, leave, fleet, timing, people
alter table people add column perms text[] not null default '{}';
alter table people add column cleared boolean not null default false;
create or replace function has_perm(area text) returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'owner' or area = any(perms) from people where user_id = auth.uid()), false) $$;
create or replace function is_boss() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'owner' or cardinality(perms) > 0 from people where user_id = auth.uid()), false) $$;
alter table runs add column label text, add column network text, add column slots int not null default 1,
  add column needs_van boolean not null default true, add column sort int not null default 100, add column windows jsonb not null default '{}';
alter table shifts add column slot int not null default 1;
alter table shifts add column trainee text references people(id);
alter table shifts add constraint shifts_day_run_slot_key unique (day, run, slot);
alter table vans add column make text, add column colour text;
alter table addons add column minutes int not null default 0, add column task boolean not null default false, add column short text;
create table run_skills (driver text references people(id) on delete cascade, run text references runs(code) on delete cascade,
  level text not null check (level in ('yes','tr')), primary key (driver, run));
alter table run_skills enable row level security;
create policy read_all on run_skills for select to authenticated using (true);
create policy roster_write on run_skills for all to authenticated using (has_perm('roster')) with check (has_perm('roster'));
create table week_notes (week_start date primary key, notes text not null default '', updated_at timestamptz not null default now());
alter table week_notes enable row level security;
create policy read_all on week_notes for select to authenticated using (is_boss());
create policy roster_write on week_notes for all to authenticated using (has_perm('roster')) with check (has_perm('roster'));
alter policy boss_write on shifts using (has_perm('roster')) with check (has_perm('roster'));
alter policy boss_all on roster_changes using (has_perm('roster')) with check (has_perm('roster'));
alter policy boss_all on roster_change_items using (has_perm('roster')) with check (has_perm('roster'));
alter policy boss_all on runs using (has_perm('roster')) with check (has_perm('roster'));
alter policy boss_all on addons using (has_perm('roster')) with check (has_perm('roster'));
alter policy boss_all on vans using (has_perm('fleet') or has_perm('roster')) with check (has_perm('fleet') or has_perm('roster'));
alter policy boss_all on timing_rules using (has_perm('timing')) with check (has_perm('timing'));
alter policy boss_upd on leave_requests using (has_perm('leave')) with check (has_perm('leave'));
alter policy boss_upd on alerts using (has_perm('alerts')) with check (has_perm('alerts'));
alter policy owner_write on people using (has_perm('people')) with check (has_perm('people'));
alter publication supabase_realtime add table run_skills, week_notes, people, vans, runs, addons, timing_rules;
