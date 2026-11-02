-- Staff who only look after the fleet (alerts but no roster/scorecard) see vehicle alerts only
create policy fleet_only_scope on public.alerts as restrictive for select to authenticated
  using (driver = me() or has_perm('roster') or has_perm('scorecard') or not is_boss() or coalesce(dedupe_key, '') like 'vchk|%');
