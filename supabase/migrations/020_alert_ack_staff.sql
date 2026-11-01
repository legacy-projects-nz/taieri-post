create or replace function public.alert_ack(p_id uuid) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update alerts set resolved_at = now(), resolved_by = me() where id = p_id and (driver = me() or is_boss()) and resolved_at is null;
end $$;
