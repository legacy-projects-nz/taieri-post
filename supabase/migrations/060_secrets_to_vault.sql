-- Secrets move from the plain app_secrets table into Supabase Vault (encrypted at rest).
-- public.app_secrets stays as a read-only view for the edge functions and cron jobs, so nothing else has to change.
-- Safe to stop halfway: the copy is checked against the table before the table is dropped, and the whole file runs as one transaction.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

do $$ declare r record; begin
  for r in select key, value from public.app_secrets loop
    if not exists (select 1 from vault.secrets where name = r.key) then
      perform vault.create_secret(r.value, r.key, 'Taieri Post app secret (moved from app_secrets)');
    end if;
  end loop;
  if exists (select 1 from public.app_secrets a left join vault.decrypted_secrets d on d.name = a.key where d.decrypted_secret is distinct from a.value) then
    raise exception 'vault copy does not match app_secrets; nothing changed';
  end if;
end $$;

create function private.app_secrets_read() returns table(key text, value text)
language sql stable security definer set search_path = '' as $$
  select name::text, decrypted_secret::text from vault.decrypted_secrets where description like 'Taieri Post app secret%'
$$;
revoke all on function private.app_secrets_read() from public, anon, authenticated;
grant execute on function private.app_secrets_read() to service_role;

drop table public.app_secrets;
create view public.app_secrets with (security_invoker = true) as select key, value from private.app_secrets_read();
revoke all on public.app_secrets from public, anon, authenticated;
grant select on public.app_secrets to service_role;
-- To add or change a secret from now on:  select vault.create_secret('<value>', '<key>', 'Taieri Post app secret');
--                                         select vault.update_secret((select id from vault.secrets where name = '<key>'), '<new value>');
