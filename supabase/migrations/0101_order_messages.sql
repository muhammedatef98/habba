-- 0101 — The customer and the technician can talk
--
-- A technician pulls into a car park and cannot say «أنا عند المدخل»; the
-- customer cannot say «السيارة في الدور -2». The tracking screen has had a
-- chat button since Phase 3, disabled, waiting for a masked phone relay nobody
-- has bought. Messages inside the order are the relay: neither side learns the
-- other's number, the thread ends with the job, and operators can read it when
-- a dispute needs to.
--
--   order_messages        append-only; read by the order's customer, its
--                         assigned provider, and operators
--   send_order_message()  the only way in: the caller must be one of the two
--                         parties, the job must be live (accepted → awaiting
--                         approval), the text 1–1000 characters, and no more
--                         than 20 a minute from one sender on one order.
--                         The other party is notified.

create table public.order_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete restrict,
  sender_side text not null check (sender_side in ('customer', 'provider')),
  body        text not null check (length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index order_messages_order_idx  on public.order_messages (order_id, created_at);
create index order_messages_sender_idx on public.order_messages (sender_id);

alter table public.order_messages enable row level security;

create policy order_messages_read on public.order_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_messages.order_id
         and (o.customer_id = (select auth.uid())
              or o.provider_id = (select public.current_provider_id())))
    or (select public.is_ops())
  );

grant select on public.order_messages to authenticated;
revoke insert, update, delete, truncate on public.order_messages from public, anon, authenticated;


create or replace function public.send_order_message(p_order_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     public.orders%rowtype;
  v_side      text;
  v_body      text := btrim(coalesce(p_body, ''));
  v_id        uuid;
  v_recipient uuid;
begin
  select * into v_order from public.orders where id = p_order_id;

  if found and v_order.customer_id = auth.uid() then
    v_side := 'customer';
  elsif found and v_order.provider_id is not null
        and v_order.provider_id = public.current_provider_id() then
    v_side := 'provider';
  else
    -- The same answer whether the order exists or not.
    raise exception 'Not a party to this order'
      using errcode = 'insufficient_privilege', hint = 'chat:not_party';
  end if;

  if v_order.status not in
       ('accepted', 'checked_in', 'en_route', 'arrived', 'in_progress', 'awaiting_approval') then
    raise exception 'Messages are open only while the job is live'
      using errcode = 'check_violation', hint = 'chat:closed';
  end if;

  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'A message is 1 to 1000 characters'
      using errcode = 'check_violation', hint = 'chat:length';
  end if;

  if (select count(*) from public.order_messages m
       where m.order_id = p_order_id and m.sender_id = auth.uid()
         and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many messages; wait a moment'
      using errcode = 'check_violation', hint = 'chat:rate';
  end if;

  insert into public.order_messages (order_id, sender_id, sender_side, body)
  values (p_order_id, auth.uid(), v_side, v_body)
  returning id into v_id;

  if v_side = 'customer' then
    select p.owner_profile_id into v_recipient
      from public.providers p where p.id = v_order.provider_id;
    perform public.enqueue_notification(
      v_recipient, 'order_message',
      'رسالة من العميل', 'Message from the customer',
      left(v_body, 140), left(v_body, 140),
      jsonb_build_object('route', '/chat', 'id', p_order_id, 'side', 'provider'),
      format('msg:%s', v_id));
  else
    perform public.enqueue_notification(
      v_order.customer_id, 'order_message',
      'رسالة من الفنّي', 'Message from your technician',
      left(v_body, 140), left(v_body, 140),
      jsonb_build_object('route', '/chat', 'id', p_order_id, 'side', 'customer'),
      format('msg:%s', v_id));
  end if;

  return v_id;
end;
$$;

comment on function public.send_order_message(uuid, text) is
  'A message in a live order, from its customer or assigned provider; notifies the other. 0101.';

revoke all on function public.send_order_message(uuid, text) from public, anon;
grant execute on function public.send_order_message(uuid, text) to authenticated;

-- Live delivery, where the publication exists (it does on Supabase, not in
-- the bare-Postgres harness). RLS decides who receives each row.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'order_messages') then
    alter publication supabase_realtime add table public.order_messages;
  end if;
end
$$;
