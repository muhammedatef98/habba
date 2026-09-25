-- push-tick, wired on a hosted project (docs/supabase-setup.md §7a).
--
-- Not a migration: it names this project's URL and needs pg_net, pg_cron and
-- Vault, which the local harness does not have. Idempotent — run it again
-- after changing anything here. Replace the project ref when using it on
-- another project.
--
-- Needs, once: the push-tick function deployed (--no-verify-jwt) and a Vault
-- secret named push_tick_secret (0087 lets the function read it from there):
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_tick_secret');

create extension if not exists pg_net;

-- One call to push-tick, with the secret from Vault. Never raises: an insert
-- into the outbox must not fail because the poke could not be sent — the
-- schedule below picks the notification up within a minute regardless.
create or replace function public.poke_push_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url     := 'https://zelhhlcfyhdqbxsykpnk.supabase.co/functions/v1/push-tick',
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-habba-tick', (select s.decrypted_secret from vault.decrypted_secrets s
                                   where s.name = 'push_tick_secret')),
    body    := '{}'::jsonb);
exception when others then
  raise warning 'push-tick poke failed: %', sqlerrm;
end;
$$;

revoke execute on function public.poke_push_tick() from public, anon, authenticated;

-- Immediate: a job offer is decided in seconds, so it leaves as soon as it is
-- queued. Once per statement, not per row: one call drains the whole batch.
create or replace function public.poke_push_tick_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.poke_push_tick();
  return null;
end;
$$;

revoke execute on function public.poke_push_tick_on_insert() from public, anon, authenticated;

drop trigger if exists notification_outbox_poke_push on public.notification_outbox;
create trigger notification_outbox_poke_push
  after insert on public.notification_outbox
  for each statement execute function public.poke_push_tick_on_insert();

-- The safety net: retries, receipts, and anything the trigger missed. Claims
-- are leased (0066), so the two never send the same notification twice.
select cron.unschedule(jobid) from cron.job where jobname = 'habba-push-tick';
select cron.schedule('habba-push-tick', '* * * * *', $$ select public.poke_push_tick(); $$);
