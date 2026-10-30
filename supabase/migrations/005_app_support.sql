-- App support: driver RPCs, roster_sent, ack admin columns, storage, cron, push keys (30 Oct 2026)

-- Shifts: driver game plan and task completion
alter table shifts add column plan jsonb not null default '{}';   -- {addon_id: "HH:MM"}
alter table shifts add column done jsonb not null default '{}';   -- {addon_id: ISO}

-- Drivers may change the add-ons, plan and done flags on their OWN shift only
create or replace function set_my_addons(p_shift uuid, p_addons text[]) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and driver = me()) then raise exception 'not your shift'; end if;
  update shifts set addons = p_addons where id = p_shift;
  perform log_event('addons_changed', p_shift::text || ' → ' || array_to_string(p_addons, ','));
end $$;
create or replace function set_my_plan(p_shift uuid, p_plan jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and driver = me()) then raise exception 'not your shift'; end if;
  update shifts set plan = p_plan where id = p_shift;
end $$;
create or replace function task_done(p_shift uuid, p_addon text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from shifts where id = p_shift and driver = me()) then raise exception 'not your shift'; end if;
  update shifts set done = done || jsonb_build_object(p_addon, now()) where id = p_shift;
end $$;
create or replace function update_my_profile(p_phone text, p_lic_class text, p_lic_exp date, p_dg_exp date) returns void language plpgsql security definer set search_path = public as $$
begin
  update people set phone = p_phone, licence_class = p_lic_class, licence_expiry = p_lic_exp, dg_expiry = p_dg_exp where id = me();
  perform log_event('profile_updated', me());
end $$;
revoke execute on function set_my_addons(uuid, text[]) from public, anon; grant execute on function set_my_addons(uuid, text[]) to authenticated;
revoke execute on function set_my_plan(uuid, jsonb) from public, anon; grant execute on function set_my_plan(uuid, jsonb) to authenticated;
revoke execute on function task_done(uuid, text) from public, anon; grant execute on function task_done(uuid, text) to authenticated;
revoke execute on function update_my_profile(text, text, date, date) from public, anon; grant execute on function update_my_profile(text, text, date, date) to authenticated;

-- What drivers were last told (baseline for "Send changes")
create table roster_sent (shift_key text primary key, snapshot jsonb not null, sent_at timestamptz not null default now());
alter table roster_sent enable row level security;
create policy read on roster_sent for select to authenticated using (is_boss());
create policy roster_write on roster_sent for all to authenticated using (has_perm('roster')) with check (has_perm('roster'));
create policy require_2fa_staff on roster_sent as restrictive to authenticated using (staff_ok()) with check (staff_ok());
alter publication supabase_realtime add table roster_sent;

-- Acks: admin confirm / dismiss
alter table change_acks add column dismissed_at timestamptz, add column confirmed_by text references people(id);
create policy boss_upd on change_acks for update to authenticated using (has_perm('roster')) with check (has_perm('roster'));

-- Staff may add leave for a driver; a driver's own insert already exists
create policy leave_ins_staff on leave_requests for insert to authenticated with check (has_perm('leave'));

-- Storage bucket for vehicle-check photos (private; signed URLs for staff)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('vchk', 'vchk', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic'])
  on conflict (id) do nothing;
create policy vchk_upload on storage.objects for insert to authenticated with check (bucket_id = 'vchk' and (me() is not null));
create policy vchk_read on storage.objects for select to authenticated using (bucket_id = 'vchk' and (is_boss() or owner = auth.uid()));

-- Push keys and cron
insert into app_secrets(key, value) values ('vapid_private', '__VAPID_PRIVATE__') on conflict (key) do nothing;
insert into settings(key, value) values ('push', '{"vapid_public":"BN21dKl_FntNzE1vG4NnPJYNY1LdH0FlGBcEfCXUIBhsqQt3KjvA8xNrouJoH_zajaJWcWJXM05NdF88zJhyl9Q"}') on conflict (key) do nothing;
select cron.schedule('tick-every-minute', '* * * * *', $$
  select net.http_post(
    url := 'https://vuqlrfyqbezwmftikxwt.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from app_secrets where key = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 25000)
$$);
