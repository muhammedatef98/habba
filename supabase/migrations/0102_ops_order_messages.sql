-- 0102 — Operators read a conversation only on purpose, and on the record
--
-- 0101 let operators select order_messages directly, like any other order
-- data. But a message thread is closer to a phone call than to an order
-- row: two people talking, not expecting a third. PDPL wants access to it to
-- be necessary and accountable, so the direct path is closed and the console
-- reads a thread only through ops_order_messages(), which demands a reason
-- and writes it to the audit log with the reader's name — the same shape as
-- a personal-data export (0070).

-- One statement in place, rather than drop and create: the table is in the
-- realtime publication, and the shorter the lock, the less it waits on it.
alter policy order_messages_read on public.order_messages
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_messages.order_id
         and (o.customer_id = (select auth.uid())
              or o.provider_id = (select public.current_provider_id())))
  );

create or replace function public.ops_order_messages(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_result jsonb;
begin
  perform public.assert_ops();
  v_reason := public.assert_reason(p_reason);

  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'sender_side', m.sender_side,
           'sender_name', p.full_name,
           'body', m.body,
           'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
    into v_result
    from public.order_messages m
    join public.profiles p on p.id = m.sender_id
   where m.order_id = p_order_id;

  perform public.audit_ops_read('order_messages', p_order_id::text,
                                jsonb_build_object('reason', v_reason));
  return v_result;
end;
$$;

comment on function public.ops_order_messages(uuid, text) is
  'An order''s message thread for operators, with a reason, recorded in the audit log. 0102.';

revoke all on function public.ops_order_messages(uuid, text) from public, anon;
grant execute on function public.ops_order_messages(uuid, text) to authenticated;
