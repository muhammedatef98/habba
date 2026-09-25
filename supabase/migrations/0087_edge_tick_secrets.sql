-- 0087 — The ticking functions' shared secret, from Vault
--
-- dispatch-tick, push-tick and the payments tick answer only a caller who
-- presents a shared secret (x-habba-tick). The secret was read from the
-- function's environment, which is set with `supabase secrets set` — a CLI
-- step. The scheduler that calls them (pg_cron + pg_net) already reads the
-- same secret from Vault (docs/supabase-setup.md §7a).
--
-- One copy is better than two: when the environment variable is not set, a
-- function now asks the database for the secret, with its own service key,
-- through edge_tick_secret(). The value stays in Vault; only service_role can
-- call this, and only for the three names the functions use. An environment
-- variable, when set, still wins, so nothing changes for a project configured
-- the old way.

create or replace function public.edge_tick_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_name is null or p_name not in ('dispatch_tick_secret', 'push_tick_secret', 'payments_tick_secret') then
    raise exception 'Unknown tick secret' using errcode = 'invalid_parameter_value';
  end if;
  return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = p_name limit 1);
exception
  -- No Vault (the local harness): no secret, so the function stays closed.
  when invalid_schema_name or undefined_table then
    return null;
end;
$$;

revoke execute on function public.edge_tick_secret(text) from public, anon, authenticated;
grant execute on function public.edge_tick_secret(text) to service_role;
