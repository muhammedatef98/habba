-- 0088 — The SMS hook's secrets, from Vault
--
-- send-sms-hook needs two secrets: the signing secret Supabase Auth shows
-- when the Send SMS hook is created, and the Authentica API key. Like the
-- tick secrets (0087), both can now live in Vault, entered once in the
-- dashboard's SQL editor, instead of `supabase secrets set` — a CLI step, and
-- one that tempts people to paste keys into chat.
--
-- A separate function rather than a longer list in edge_tick_secret(): that
-- one's name says what it hands out, and it should keep saying it. Same
-- shape, same rules: service_role only, named secrets only, and no Vault
-- means no secret, so the hook stays closed.

create or replace function public.edge_provider_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_name is null or p_name not in ('send_sms_hook_secret', 'authentica_api_key') then
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
