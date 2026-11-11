-- Two-step sign-in stays compulsory for admins (anyone with permissions) but no longer for the owner.
-- Before: staff_ok() was false for the owner and admins unless the session had passed the second step.
-- After:  it is false only for admins without the second step. Drivers were never asked and still aren't.
-- NOTE: this removes the second step from the account that can see and change everything. Apply only if that is what you want.
create or replace function public.staff_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' or not (cardinality(perms) > 0) from people where id = _pid()), true)
         or (auth.jwt()->>'aal') = 'aal2' $$;
