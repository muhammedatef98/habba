-- dispatch-tick, on a hosted project, without the Edge Function.
--
-- dispatch-tick is transport only: it calls expand_stale_searches() (0051)
-- and auto_complete_awaiting_orders() (0071) with the service key. pg_cron
-- can call them directly, as the job owner, every 15 seconds — no function to
-- deploy, no secret to share. Idempotent.

select cron.unschedule(jobid) from cron.job where jobname = 'habba-dispatch-tick';
select cron.schedule('habba-dispatch-tick', '15 seconds', $$
  select public.expand_stale_searches();
  select public.auto_complete_awaiting_orders();
$$);
