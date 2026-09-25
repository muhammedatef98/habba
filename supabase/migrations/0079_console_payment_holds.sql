-- 0079 — The console sees the holds on an order
--
-- Since 0078 an order can carry two holds on the customer's card — the one
-- from booking and a top-up for the difference parts made. An operator
-- chasing a failed capture needs to see both, with the payment id each was
-- made under, on the order's page.
--
-- ops_order_detail (0070) is a long function; it is wrapped rather than
-- rewritten, so this migration cannot change anything it already returns.

alter function public.ops_order_detail(uuid) rename to ops_order_detail_0070;
revoke execute on function public.ops_order_detail_0070(uuid) from public, anon, authenticated;

create or replace function public.ops_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The wrapped function asserts ops and records the read (0070).
  return public.ops_order_detail_0070(p_order_id)
    || jsonb_build_object('payment_holds', (
         select coalesce(jsonb_agg(jsonb_build_object(
                  'payment_id', h.payment_id, 'amount', h.amount, 'kind', h.kind,
                  'status', h.status, 'created_at', h.created_at) order by h.created_at), '[]'::jsonb)
           from public.payment_holds h where h.order_id = p_order_id));
end;
$$;

grant execute on function public.ops_order_detail(uuid) to authenticated;
