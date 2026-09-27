-- 0092 — The Moyasar secret key, from Vault
--
-- The `payments` function holds the only key that moves money. Like the SMS
-- hook's secrets (0088), it can now live in Vault, entered once in the
-- dashboard's SQL editor, rather than as a function secret set from the CLI.
-- The allowlist grows by exactly one name; the rules are 0088's: service_role
-- only, and no Vault means no key, so the function refuses to run.

create or replace function public.edge_provider_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_name is null
     or p_name not in ('send_sms_hook_secret', 'authentica_api_key', 'moyasar_secret_key') then
    raise exception 'Unknown provider secret' using errcode = 'invalid_parameter_value';
  end if;
  return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = p_name limit 1);
exception
  when invalid_schema_name or undefined_table then
    return null;
end;
$$;

revoke execute on function public.edge_provider_secret(text) from public, anon, authenticated;
grant execute on function public.edge_provider_secret(text) to service_role;
