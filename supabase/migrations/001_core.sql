-- Taieri Post real-time system: core schema (draft 30 Oct 2026)
-- Decisions: push notifications to drivers; SOD editable until EOD is sent;
-- roster changes can be made by Jeremy or Alejandro, but Alejandro's need Jeremy's OK.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- People -------------------------------------------------------------------
create type staff_role as enum ('owner','admin','fleet','driver');

create table people (
  id          text primary key,              -- existing driver ids (G, J, ...)
  name        text not null,
  email       text unique,
  phone       text,
  role        staff_role not null default 'driver',
  user_id     uuid unique references auth.users(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function me() returns text language sql stable security definer set search_path = public as
$$ select id from people where user_id = auth.uid() $$;

create or replace function my_role() returns staff_role language sql stable security definer set search_path = public as
$$ select role from people where user_id = auth.uid() $$;

create or replace function is_boss() returns boolean language sql stable as
$$ select coalesce(my_role() in ('owner','admin'), false) $$;

-- Runs, vans, add-ons ------------------------------------------------------
create table runs (
  code        text primary key,               -- TUA, RSB, PCB, DB, LAW, ...
  name        text not null,
  default_start time, default_end time,
  active      boolean not null default true
);

create table vans (
  plate text primary key, name text, active boolean not null default true,
  wof_due date, rego_due date, service_due_km int
);

create table addons (
  id    text primary key,                     -- airport, fish, rose, tw_t5 ...
  name  text not null,
  runs  text[] not null default '{}',
  no_saturday boolean not null default false
);

-- Roster -------------------------------------------------------------------
create table shifts (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  run         text not null references runs(code),
  driver      text references people(id),
  van         text references vans(plate),
  start_at    time, end_at time,
  addons      text[] not null default '{}',
  note        text,
  updated_at  timestamptz not null default now(),
  unique (day, run)
);
create index on shifts (driver, day);

-- A roster change = a batch of shift edits. Alejandro's need Jeremy's approval.
create type change_status as enum ('draft','awaiting_approval','sent','rejected');

create table roster_changes (
  id          uuid primary key default gen_random_uuid(),
  created_by  text not null references people(id),
  status      change_status not null default 'draft',
  approved_by text references people(id),
  sent_at     timestamptz,
  reason      text,
  created_at  timestamptz not null default now()
);

create table roster_change_items (
  id          uuid primary key default gen_random_uuid(),
  change_id   uuid not null references roster_changes(id) on delete cascade,
  shift_id    uuid references shifts(id),
  day         date not null, run text not null,
  before      jsonb, after jsonb,               -- {driver, van, start_at, end_at, addons}
  affects     text[] not null default '{}',     -- driver ids who must confirm
  summary     text not null
);

create table change_acks (
  item_id     uuid references roster_change_items(id) on delete cascade,
  driver      text references people(id),
  seen_at     timestamptz,
  confirmed_at timestamptz,
  primary key (item_id, driver)
);

-- SOD / EOD ----------------------------------------------------------------
create table sod (
  shift_id    uuid primary key references shifts(id) on delete cascade,
  driver      text not null references people(id),
  sent_at     timestamptz not null default now(),
  edited_at   timestamptz,
  van         text references vans(plate),
  start_km    int,
  note        text
);

create table eod (
  shift_id    uuid primary key references shifts(id) on delete cascade,
  driver      text not null references people(id),
  sent_at     timestamptz not null default now(),
  finish_time time, end_km int,
  stops int, parcels int, pickups int, pickup_stops int,
  extra       jsonb not null default '{}',
  note        text
);

-- Timing rules & alerts ----------------------------------------------------
create table timing_rules (
  id    text primary key,
  name  text not null,
  opens time, closes time,
  runs  text[] not null default '{}',          -- or {'ALL'}
  addon text references addons(id),
  days  int[] not null default '{1,2,3,4,5}',   -- ISO weekday
  note  text,
  active boolean not null default true
);

create type alert_kind as enum ('sod_late','sod_missing','eod_late','timing_due','timing_missed','change_unconfirmed','leave_request','message','other');

create table alerts (
  id          uuid primary key default gen_random_uuid(),
  kind        alert_kind not null,
  driver      text references people(id),
  shift_id    uuid references shifts(id) on delete cascade,
  rule_id     text references timing_rules(id),
  title       text not null,
  body        text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text references people(id),
  dedupe_key  text unique                        -- stops the same alert twice
);

-- Messages with read receipts ---------------------------------------------
create table messages (
  id          uuid primary key default gen_random_uuid(),
  sender      text not null references people(id),
  body        text not null,
  needs_confirm boolean not null default false,
  created_at  timestamptz not null default now()
);

create table message_recipients (
  message_id  uuid references messages(id) on delete cascade,
  person      text references people(id),
  read_at     timestamptz,
  confirmed_at timestamptz,
  primary key (message_id, person)
);

-- Leave --------------------------------------------------------------------
create table leave_requests (
  id          uuid primary key default gen_random_uuid(),
  driver      text not null references people(id),
  type        text not null,
  date_from   date not null, date_to date not null,
  part        text not null default 'full',
  notes       text,
  status      text not null default 'pending',
  decided_by  text references people(id),
  decided_at  timestamptz, reply text,
  acked_email_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Push subscriptions -------------------------------------------------------
create table push_subs (
  id        uuid primary key default gen_random_uuid(),
  person    text not null references people(id) on delete cascade,
  endpoint  text unique not null,
  keys      jsonb not null,
  created_at timestamptz not null default now()
);

-- Row-level security ------------------------------------------------------
alter table people enable row level security;
alter table runs enable row level security;
alter table vans enable row level security;
alter table addons enable row level security;
alter table shifts enable row level security;
alter table roster_changes enable row level security;
alter table roster_change_items enable row level security;
alter table change_acks enable row level security;
alter table sod enable row level security;
alter table eod enable row level security;
alter table timing_rules enable row level security;
alter table alerts enable row level security;
alter table messages enable row level security;
alter table message_recipients enable row level security;
alter table leave_requests enable row level security;
alter table push_subs enable row level security;

-- Reference data: everyone signed in reads; bosses write
create policy ref_read on runs for select to authenticated using (true);
create policy ref_read on vans for select to authenticated using (true);
create policy ref_read on addons for select to authenticated using (true);
create policy ref_read on timing_rules for select to authenticated using (true);
create policy boss_all on runs for all to authenticated using (is_boss()) with check (is_boss());
create policy boss_all on vans for all to authenticated using (is_boss() or my_role()='fleet') with check (is_boss() or my_role()='fleet');
create policy boss_all on addons for all to authenticated using (is_boss()) with check (is_boss());
create policy boss_all on timing_rules for all to authenticated using (is_boss()) with check (is_boss());

-- People: see yourself; bosses see all
create policy self_read on people for select to authenticated using (user_id = auth.uid() or is_boss());
create policy owner_write on people for all to authenticated using (my_role()='owner') with check (my_role()='owner');

-- Shifts: drivers read whole roster (to see who's where), only bosses write
create policy read_all on shifts for select to authenticated using (true);
create policy boss_write on shifts for all to authenticated using (is_boss()) with check (is_boss());

-- Roster changes: bosses manage; only owner can move to 'sent' from awaiting_approval (enforced in send function)
create policy boss_all on roster_changes for all to authenticated using (is_boss()) with check (is_boss());
create policy boss_all on roster_change_items for all to authenticated using (is_boss()) with check (is_boss());
create policy driver_read on roster_change_items for select to authenticated
  using (me() = any(affects) and exists (select 1 from roster_changes c where c.id = change_id and c.status='sent'));

-- Acks: driver reads/updates own; bosses read all
create policy own on change_acks for select to authenticated using (driver = me() or is_boss());
create policy own_upd on change_acks for update to authenticated using (driver = me()) with check (driver = me());
create policy boss_ins on change_acks for insert to authenticated with check (is_boss());

-- SOD: driver inserts own; can edit until EOD exists
create policy read on sod for select to authenticated using (driver = me() or is_boss());
create policy ins on sod for insert to authenticated with check (driver = me() or is_boss());
create policy upd on sod for update to authenticated
  using ((driver = me() and not exists (select 1 from eod e where e.shift_id = sod.shift_id)) or is_boss())
  with check (driver = me() or is_boss());

create policy read on eod for select to authenticated using (driver = me() or is_boss());
create policy ins on eod for insert to authenticated with check (driver = me() or is_boss());
create policy upd on eod for update to authenticated using (is_boss()) with check (is_boss());

-- Alerts: bosses see all; drivers see their own
create policy read on alerts for select to authenticated using (is_boss() or driver = me());
create policy boss_upd on alerts for update to authenticated using (is_boss()) with check (is_boss());

-- Messages
create policy read on messages for select to authenticated using (
  is_boss() or sender = me() or exists (select 1 from message_recipients r where r.message_id = messages.id and r.person = me()));
create policy send on messages for insert to authenticated with check (sender = me());
create policy read on message_recipients for select to authenticated using (person = me() or is_boss()
  or exists (select 1 from messages m where m.id = message_id and m.sender = me()));
create policy add on message_recipients for insert to authenticated with check (
  exists (select 1 from messages m where m.id = message_id and m.sender = me()));
create policy mark on message_recipients for update to authenticated using (person = me()) with check (person = me());

-- Leave
create policy read on leave_requests for select to authenticated using (driver = me() or is_boss());
create policy ins on leave_requests for insert to authenticated with check (driver = me());
create policy boss_upd on leave_requests for update to authenticated using (is_boss()) with check (is_boss());

-- Push subs: own only
create policy own on push_subs for all to authenticated using (person = me()) with check (person = me());

-- Real-time: broadcast changes on the live tables
alter publication supabase_realtime add table shifts, sod, eod, alerts, change_acks,
  roster_changes, roster_change_items, messages, message_recipients, leave_requests;
