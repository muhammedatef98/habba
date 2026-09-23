-- 41 — Operators: two factors, eight hours, and every change on the record
--
-- Companion to 0068.

\echo '── ops two-factor and audit'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-eb00-000000000001', '+966509300001'),  -- operator
  ('22222222-0000-4000-eb00-000000000002', '+966509300002'),  -- customer
  ('33333333-0000-4000-eb00-000000000003', '+966509300003');  -- applicant

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-eb00-000000000001', 'المشغّل', '+966509300001'),
  ('22222222-0000-4000-eb00-000000000002', 'العميل', '+966509300002'),
  ('33333333-0000-4000-eb00-000000000003', 'المتقدّم', '+966509300003');

select test.grant_role('11111111-0000-4000-eb00-000000000001', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-eb00-000000000001', 'الدمام', 'DammamOps', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id,
   national_id_encrypted)
values
  ('e0000000-0000-4000-eb00-000000000001', '33333333-0000-4000-eb00-000000000003',
   'individual', 'فنّي متقدّم', 'pending', 'c0000000-0000-4000-eb00-000000000001',
   'vault:ciphertext-that-must-not-leak');

set role authenticated;


-- A password alone opens nothing ---------------------------------------------------------
select test.become_password_only('11111111-0000-4000-eb00-000000000001');

select test.assert(not public.is_ops(), 'an operator signed in with a password only is not ops yet');

select test.assert_raises(
  $$select public.set_provider_verification('e0000000-0000-4000-eb00-000000000001', 'approved')$$,
  'and cannot approve a technician — a phished password is not enough', '42501');

select test.assert(
  (select role = 'ops' and aal = 'aal1' and not session_ok from public.ops_whoami()),
  'the console is told they are an operator who still has to verify');


-- Eight hours, then verify again ---------------------------------------------------------------
select test.become_verified_ago('11111111-0000-4000-eb00-000000000001', interval '9 hours');
select test.assert(not public.is_ops(), 'a second factor verified nine hours ago has lapsed');

select test.become_verified_ago('11111111-0000-4000-eb00-000000000001', interval '7 hours');
select test.assert(public.is_ops(), 'seven hours ago is still inside the session');

select test.assert(
  (select expires_at between now() + interval '59 minutes' and now() + interval '61 minutes'
     from public.ops_whoami()),
  'and the console is told when the session ends');


-- Every change on the record ------------------------------------------------------------------
select test.become('11111111-0000-4000-eb00-000000000001');
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1"}', true);

select public.set_provider_verification('e0000000-0000-4000-eb00-000000000001', 'approved');

select test.assert_eq(
  (select count(*)::int from public.audit_log
    where target_table = 'providers' and target_id = 'e0000000-0000-4000-eb00-000000000001'),
  1, 'approving a technician writes one audit row');

select test.assert(
  (select actor_id = '11111111-0000-4000-eb00-000000000001'
      and action = 'update'
      and before ->> 'verification_status' = 'pending'
      and after ->> 'verification_status' = 'approved'
      and ip = '203.0.113.7'::inet
     from public.audit_log where target_table = 'providers'),
  'saying who, what it was, what it became, and from where');

select test.assert(
  (select not (before ? 'national_id_encrypted') and not (after ? 'national_id_encrypted')
     from public.audit_log where target_table = 'providers'),
  'without the KYC ciphertext operators are not allowed to read');

update public.services set est_duration_min = est_duration_min + 5
 where name_en = 'Battery jump or replacement';

select test.assert_eq(
  (select count(*)::int from public.audit_log where target_table = 'services'),
  1, 'a direct table edit is recorded as surely as an RPC');


-- Nobody rewrites it ----------------------------------------------------------------------------------
select test.assert_raises(
  $$update public.audit_log set actor_id = '22222222-0000-4000-eb00-000000000002'$$,
  'an operator cannot rewrite the log', '42501');

select test.assert_raises(
  $$delete from public.audit_log$$,
  'or delete from it', '42501');

reset role;
select test.assert_raises(
  $$update public.audit_log set action = 'nothing'$$,
  'not even the table owner — the trigger refuses as well as the grants', '42501');

set role service_role;
select test.assert_raises(
  $$insert into public.audit_log (actor_id, action, target_table, target_id)
    values ('22222222-0000-4000-eb00-000000000002', 'forged', 'orders', 'x')$$,
  'a leaked service key cannot forge an entry', '42501');
reset role;


-- Only operators read it; nobody else's changes are logged as theirs ----------------------------------
set role authenticated;
select test.become('22222222-0000-4000-eb00-000000000002');

select test.assert_eq(
  (select count(*)::int from public.audit_log), 0,
  'a customer cannot read the log');

select test.assert(
  (select role is null from public.ops_whoami()),
  'and is told they are not an operator at all');

update public.profiles set full_name = 'عميل' where id = '22222222-0000-4000-eb00-000000000002';
reset role;

select test.assert_eq(
  (select count(*)::int from public.audit_log where actor_id = '22222222-0000-4000-eb00-000000000002'),
  0, 'a customer changing their own things is not an admin action');

rollback;

\echo '   ops two-factor and audit OK'
