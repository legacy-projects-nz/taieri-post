-- Income and pay settings are private. Every phone loads the settings table, so business income
-- (money_model, tge_south) is owner-only and pay bands are for staff with the scorecard area.
-- Restrictive, so no other policy (read_all, people_write) can open these rows up.
drop policy if exists private_keys on settings;
create policy private_keys on settings as restrictive for select to authenticated using (
  case
    when key in ('money_model', 'tge_south') then my_role() = 'owner'
    when key = 'bands' then has_perm('scorecard')
    else true
  end
);
