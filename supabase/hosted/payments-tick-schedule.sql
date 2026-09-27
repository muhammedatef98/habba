-- The payments tick, wired on a hosted project (docs/supabase-setup.md §7b).
--
-- Not a migration, for push-tick-schedule.sql's reasons: it names this
-- project's URL and needs pg_net, pg_cron and Vault. Idempotent.
--
-- Needs, once: the payments function deployed (--no-verify-jwt) and a Vault
-- secret named payments_tick_secret — nobody types it, the function and the
-- schedule both read it from Vault (0087):
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payments_tick_secret');
--
-- The tick carries out queued captures, voids and refunds (0077). With
-- `payments_gateway` still `dev` the queue stays empty and each call is a
-- no-op, so scheduling it early is harmless.

create extension if not exists pg_net with schema extensions;

create or replace function public.poke_payments_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url     := 'https://zelhhlcfyhdqbxsykpnk.supabase.co/functions/v1/payments',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-habba-tick', (select s.decrypted_secret from vault.decrypted_secrets s
                                   where s.name = 'payments_tick_secret')),
    body    := '{"action":"tick"}'::jsonb);
exception when others then
  raise warning 'payments tick poke failed: %', sqlerrm;
end;
$$;

revoke execute on function public.poke_payments_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'habba-payments-tick';
select cron.schedule('habba-payments-tick', '30 seconds', $$ select public.poke_payments_tick(); $$);
