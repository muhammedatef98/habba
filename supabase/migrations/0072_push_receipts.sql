-- 0072 — Knowing a notification arrived, not only that it left
--
-- push-tick recorded Expo's ticket — "accepted" — and stopped there. Whether
-- Apple or Google then delivered it is only in the receipt, which Expo keeps
-- for about a day and which nobody fetched. That mattered twice over:
--
--   * an app that was uninstalled usually gets an `ok` ticket and a
--     `DeviceNotRegistered` receipt, so dead tokens were never retired and
--     every notification to them quietly went nowhere, forever;
--   * the console's notification log said "sent" for messages that never
--     reached anyone, and credential or rate-limit failures were invisible.
--
-- Now each accepted message leaves a ticket; push-tick asks for receipts once
-- they are due (15 minutes on) and reports back. A delivered notification is
-- marked delivered; a failed one carries the reason; a dead install is
-- retired.

alter table public.notification_outbox
  add column delivered_at timestamptz;

create table public.push_tickets (
  ticket_id       text primary key,
  notification_id uuid not null references public.notification_outbox (id) on delete cascade,
  token           text not null,
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  checked_at      timestamptz,
  status          text check (status in ('ok', 'error', 'expired')),
  error           text
);

create index push_tickets_due_idx on public.push_tickets (created_at) where checked_at is null;

-- Nobody reads or writes this but the functions below, called by push-tick
-- with the service role.
alter table public.push_tickets enable row level security;
revoke all on public.push_tickets from anon, authenticated;


-- Reports back, as in 0066, plus the tickets of what Expo accepted.
drop function public.record_push_results(uuid[], uuid[], text[], text);

create or replace function public.record_push_results(
  p_sent        uuid[],
  p_retry       uuid[],
  p_dead_tokens text[],
  p_error       text default null,
  p_tickets     jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox
     set sent_at = now(), claimed_at = null, last_error = null
   where id = any(coalesce(p_sent, '{}'));

  update public.notification_outbox
     set claimed_at = null,
         last_error = coalesce(p_error, 'retry'),
         abandoned_at = case when attempts >= 5 then now() end
   where id = any(coalesce(p_retry, '{}'))
     and sent_at is null;

  update public.push_devices
     set disabled_at = now()
   where token = any(coalesce(p_dead_tokens, '{}'))
     and disabled_at is null;

  insert into public.push_tickets (ticket_id, notification_id, token)
  select t ->> 'ticket_id', (t ->> 'notification_id')::uuid, t ->> 'token'
    from jsonb_array_elements(coalesce(p_tickets, '[]'::jsonb)) as t
   where t ->> 'ticket_id' is not null
  on conflict (ticket_id) do nothing;
end;
$$;

-- Tickets whose receipts are due: at least 15 minutes old (Expo's advice), and
-- not already being checked by another tick. Anything older than a day has no
-- receipt any more and is closed as expired rather than asked about forever;
-- a week later the ticket itself is dropped.
create or replace function public.claim_push_receipts(p_limit int default 1000)
returns table (ticket_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_tickets t
     set checked_at = now(), status = 'expired'
   where t.checked_at is null and t.created_at < now() - interval '24 hours';

  delete from public.push_tickets t where t.checked_at < now() - interval '7 days';

  return query
  with due as (
    select t.ticket_id
      from public.push_tickets t
     where t.checked_at is null
       and t.created_at < now() - interval '15 minutes'
       and (t.claimed_at is null or t.claimed_at < now() - interval '2 minutes')
     order by t.created_at
     limit greatest(1, least(p_limit, 1000))
       for update skip locked
  )
  update public.push_tickets t
     set claimed_at = now()
    from due
   where t.ticket_id = due.ticket_id
  returning t.ticket_id;
end;
$$;

-- p_receipts: [{ticket_id, status: ok|error|pending, error}].
create or replace function public.record_push_receipts(p_receipts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with r as (
    select x ->> 'ticket_id' as ticket_id, x ->> 'status' as status, x ->> 'error' as error
      from jsonb_array_elements(coalesce(p_receipts, '[]'::jsonb)) as x
  )
  update public.push_tickets t
     set checked_at = case when r.status = 'pending' then null else now() end,
         claimed_at = null,
         status = case when r.status = 'pending' then null else r.status end,
         error = r.error
    from r
   where t.ticket_id = r.ticket_id;

  -- Delivered to at least one device: the notification arrived.
  update public.notification_outbox n
     set delivered_at = coalesce(n.delivered_at, now())
   where exists (select 1 from public.push_tickets t
                  where t.notification_id = n.id and t.status = 'ok'
                    and t.ticket_id in (select x ->> 'ticket_id'
                                          from jsonb_array_elements(p_receipts) as x));

  -- Failed on every device it was sent to: say why, where the console shows it.
  update public.notification_outbox n
     set last_error = 'receipt: ' || t.error
    from public.push_tickets t
   where t.notification_id = n.id
     and t.status = 'error'
     and n.delivered_at is null
     and t.ticket_id in (select x ->> 'ticket_id' from jsonb_array_elements(p_receipts) as x);

  -- The app was uninstalled: stop sending to it.
  update public.push_devices d
     set disabled_at = now()
    from public.push_tickets t
   where t.token = d.token
     and t.status = 'error'
     and t.error = 'DeviceNotRegistered'
     and d.disabled_at is null
     and t.ticket_id in (select x ->> 'ticket_id' from jsonb_array_elements(p_receipts) as x);
end;
$$;

revoke execute on function public.record_push_results(uuid[], uuid[], text[], text, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_push_receipts(int) from public, anon, authenticated;
revoke execute on function public.record_push_receipts(jsonb) from public, anon, authenticated;
grant execute on function public.record_push_results(uuid[], uuid[], text[], text, jsonb) to service_role;
grant execute on function public.claim_push_receipts(int) to service_role;
grant execute on function public.record_push_receipts(jsonb) to service_role;


-- The console's notification log shows delivery, not only sending (0070).
create or replace function public.ops_list_records(p_kind text, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  if p_kind = 'broadcasts' then
    return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
              select b.*, sp.full_name as sent_by_name
                from public.ops_broadcasts b left join public.profiles sp on sp.id = b.sent_by
               order by b.created_at desc limit p_limit) x);
  elsif p_kind = 'data_requests' then
    return (select coalesce(jsonb_agg(x order by x.handled_at desc), '[]'::jsonb) from (
              select d.*, p.full_name as user_name, hp.full_name as handled_by_name
                from public.data_requests d
                left join public.profiles p on p.id = d.user_id
                left join public.profiles hp on hp.id = d.handled_by
               order by d.handled_at desc limit p_limit) x);
  elsif p_kind = 'transfers' then
    return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
              select t.id, t.vehicle_id, v.plate_ar, t.status, fp.full_name as from_name,
                     coalesce(tp.full_name, t.to_phone, t.to_email) as to_name, t.created_at,
                     t.expires_at, t.failed_attempts, t.locked_at
                from public.ownership_transfers t
                join public.vehicles v on v.id = t.vehicle_id
                join public.profiles fp on fp.id = t.from_owner_id
                left join public.profiles tp on tp.id = t.to_owner_id
               order by t.created_at desc limit p_limit) x);
  elsif p_kind = 'reports' then
    return (select coalesce(jsonb_agg(x order by x.generated_at desc), '[]'::jsonb) from (
              select r.id, r.vehicle_id, v.plate_ar, r.generated_at, r.expires_at, r.revoked_at,
                     r.chain_valid, r.chain_length
                from public.habba_reports r join public.vehicles v on v.id = r.vehicle_id
               order by r.generated_at desc limit p_limit) x);
  elsif p_kind = 'notifications' then
    return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
              select n.id, n.kind, n.title_ar, p.full_name as user_name, n.created_at, n.sent_at,
                     n.delivered_at, n.abandoned_at, n.attempts, n.last_error, n.expires_at
                from public.notification_outbox n left join public.profiles p on p.id = n.user_id
               order by n.created_at desc limit p_limit) x);
  end if;
  raise exception 'Unknown record kind %', p_kind using errcode = 'invalid_parameter_value';
end;
$$;
