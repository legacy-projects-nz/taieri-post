-- Drivers must fill in / confirm their profile (phone, licence, DG) the next time they open the app.
-- profile_confirmed_at is set when they save their own details; null = ask on next open.
alter table public.people add column if not exists profile_confirmed_at timestamptz;
create or replace function update_my_profile(p_phone text, p_lic_class text, p_lic_exp date, p_dg_exp date) returns void language plpgsql security definer set search_path = public as $$
begin
  update people set phone = p_phone, licence_class = p_lic_class, licence_expiry = p_lic_exp, dg_expiry = p_dg_exp, profile_confirmed_at = now() where id = me();
  perform log_event('profile_updated', me());
end $$;
revoke execute on function update_my_profile(text, text, date, date) from public, anon; grant execute on function update_my_profile(text, text, date, date) to authenticated;
