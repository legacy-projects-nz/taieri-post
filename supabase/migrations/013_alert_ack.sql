-- 013: drivers can tick "Got it" on their own Admin tasks (alerts) (1 Nov 2026).
create or replace function public.alert_ack(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update alerts set resolved_at = now(), resolved_by = me() where id = p_id and driver = me() and resolved_at is null;
end $$;
grant execute on function public.alert_ack(uuid) to authenticated;
