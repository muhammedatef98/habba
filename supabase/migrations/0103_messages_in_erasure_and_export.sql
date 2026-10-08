-- 0103 — Order messages follow the person: erased with them, exported to them
--
-- 0101 added something people write in their own words — «السيارة في الدور
-- -2 بجانب مدخل العمارة» — which can carry exactly the address and name that
-- erasure (0086) already removes from orders. Left alone, deleting an account
-- would erase the order's address and keep it in the chat. And a personal-data
-- export (0070) that leaves out what the person wrote is not the whole of it.
--
-- Both functions are wrapped, as 0096 wrapped the order file: the earlier
-- body runs unchanged, and this adds the messages.
--
--   erase_account()         the person's own messages become «رسالة محذوفة».
--                           What the other party wrote is theirs and stays,
--                           as ratings about the person stay (0070).
--   ops_export_user_data()  adds `order_messages`: what the person sent.

alter function public.erase_account(uuid, text, uuid) rename to erase_account_0089;
revoke execute on function public.erase_account_0089(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.erase_account(p_user_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Refuses, while something is still owed, before anything is touched (0086).
  perform public.erase_account_0089(p_user_id, p_reason, p_actor);

  update public.order_messages
     set body = 'رسالة محذوفة'
   where sender_id = p_user_id;
end;
$$;

revoke execute on function public.erase_account(uuid, text, uuid) from public, anon, authenticated;


alter function public.ops_export_user_data(uuid, text) rename to ops_export_user_data_0070;
revoke execute on function public.ops_export_user_data_0070(uuid, text) from public, anon, authenticated;

create or replace function public.ops_export_user_data(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The wrapped body asserts ops, checks the reason and records the export.
  return public.ops_export_user_data_0070(p_user_id, p_reason)
    || jsonb_build_object(
         'order_messages', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'order_id', m.order_id, 'sender_side', m.sender_side,
                    'body', m.body, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
             from public.order_messages m
            where m.sender_id = p_user_id));
end;
$$;

revoke execute on function public.ops_export_user_data(uuid, text) from public, anon;
grant execute on function public.ops_export_user_data(uuid, text) to authenticated;
