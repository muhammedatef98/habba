-- 54 — Deleting your own account, from the app
--
-- Companion to 0086. The person can erase their own account — the same
-- erasure a super admin performs — but not while something is still owed,
-- not by accident, and not someone else's.

\echo '── delete my account'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-5454-000000000001', '+966509540001'),  -- leaves
  ('22222222-0000-4000-5454-000000000002', '+966509540002'),  -- has an open order
  ('33333333-0000-4000-5454-000000000003', '+966509540003');  -- operator
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5454-000000000001', 'المغادر', '+966509540001'),
  ('22222222-0000-4000-5454-000000000002', 'صاحب الطلب', '+966509540002'),
  ('33333333-0000-4000-5454-000000000003', 'المشغّل', '+966509540003');
select test.grant_role('33333333-0000-4000-5454-000000000003', 'ops');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-5454-000000000001', 'ماركة', 'TestMakeErase');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-5454-000000000001', 'a0000000-0000-4000-5454-000000000001',
   'موديل', 'TestModelErase', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, nickname) values
  ('d0000000-0000-4000-5454-000000000001', '11111111-0000-4000-5454-000000000001',
   'a0000000-0000-4000-5454-000000000001', 'b0000000-0000-4000-5454-000000000001',
   2021, 'KND 5454', 'سيارتي'),
  ('d0000000-0000-4000-5454-000000000002', '22222222-0000-4000-5454-000000000002',
   'a0000000-0000-4000-5454-000000000001', 'b0000000-0000-4000-5454-000000000001',
   2020, 'KND 5455', null);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

set role authenticated;

-- Refusals ------------------------------------------------------------------------------
select test.become_anon();
select test.assert_raises($$select public.delete_my_account('DELETE')$$,
  'nobody signed in deletes anything', '42501');

select test.become('11111111-0000-4000-5454-000000000001');
select test.assert_raises($$select public.delete_my_account('delete')$$,
  'without the exact confirmation, nothing is erased', '23514');
select test.assert_raises($$select public.delete_my_account(null)$$,
  'nor with none', '23514');
select test.assert_raises(
  $$select public.erase_account('22222222-0000-4000-5454-000000000002', 'x',
      '11111111-0000-4000-5454-000000000001')$$,
  'the erasure itself cannot be called to erase someone else', '42501');

select test.become('22222222-0000-4000-5454-000000000002');
select public.create_emergency_order(
  :'svc', 50.21, 26.22, 'd0000000-0000-4000-5454-000000000002',
  'الخبر', 'البطارية فارغة', 60100, '[]'::jsonb) as ord \gset
select public.authorise_order_payment(:'ord', 'pay_erase_5454');
select public.submit_order(:'ord');
select test.assert_raises($$select public.delete_my_account('DELETE')$$,
  'an account with an order in progress waits until it ends', '23514');

select test.become('33333333-0000-4000-5454-000000000003');
select test.assert_raises($$select public.delete_my_account('DELETE')$$,
  'a staff account is removed from the console, not from the app', '23514');


-- The erasure ---------------------------------------------------------------------------
select test.become('11111111-0000-4000-5454-000000000001');
select public.delete_my_account('DELETE');

reset role;
select test.assert_eq(
  (select full_name || '/' || coalesce(phone, '∅') from public.profiles
    where id = '11111111-0000-4000-5454-000000000001'),
  'مستخدم محذوف/∅', 'who the person was is gone');
select test.assert(public.is_suspended('11111111-0000-4000-5454-000000000001'),
  'and the account can no longer act');
select test.assert_eq(
  (select handled_by from public.data_requests
    where user_id = '11111111-0000-4000-5454-000000000001' and kind = 'erasure'),
  '11111111-0000-4000-5454-000000000001'::uuid,
  'the request is on record as the person''s own');
select test.assert_eq(
  (select nickname is null and not is_active from public.vehicles
    where id = 'd0000000-0000-4000-5454-000000000001'),
  true, 'the car is detached from them');
select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-5454-000000000001')),
  'and its logbook — the car''s history, not the person''s — still verifies');

rollback;

\echo '   delete my account OK'
