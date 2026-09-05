-- 27 — Provider verification as an answerable decision
--
-- Companion to 0052. Approving a provider is the moment Habba vouches for
-- someone who will be sent to a stranger's car at night. The assertions are
-- about that being recorded, and about who may do it.

\echo '── provider verification'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-f000-000000000001', '+966506000001'),  -- ops
  ('22222222-0000-4000-f000-000000000002', '+966506000002'),  -- the provider
  ('33333333-0000-4000-f000-000000000003', '+966506000003');  -- a customer

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-f000-000000000001', 'المشغّل', '+966506000001'),
  ('22222222-0000-4000-f000-000000000002', 'الفنّي',  '+966506000002'),
  ('33333333-0000-4000-f000-000000000003', 'عميل',    '+966506000003');

-- `customer` arrives with the profile (§5.1.1); anything else is granted, and
-- only ever by the server. The technician's role is NOT granted here — it is
-- what approval produces, which is the thing this suite is about.
select test.grant_role('11111111-0000-4000-f000-000000000001', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-f000-000000000001', 'الرياض', 'RiyadhVerify', 'الرياض', 'Riyadh',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-f000-000000000001', '22222222-0000-4000-f000-000000000002',
   'individual', 'ونش جديد', 'pending', 'c0000000-0000-4000-f000-000000000001');


-- Who may decide ---------------------------------------------------------------
set role authenticated;

select test.become('22222222-0000-4000-f000-000000000002');
select test.assert_raises(
  $$select public.set_provider_verification('e0000000-0000-4000-f000-000000000001', 'approved')$$,
  'a provider cannot approve themselves — that is what makes KYC theatre',
  '42501');

select test.become('33333333-0000-4000-f000-000000000003');
select test.assert_raises(
  $$select public.set_provider_verification('e0000000-0000-4000-f000-000000000001', 'approved')$$,
  'nor can a passing customer',
  '42501');

reset role;


-- The decision is recorded -----------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-f000-000000000001');

select public.set_provider_verification(
  'e0000000-0000-4000-f000-000000000001', 'approved', 'السجل التجاري والهوية مطابقان');

select test.assert_eq(
  (select verification_status::text from public.providers
    where id = 'e0000000-0000-4000-f000-000000000001'),
  'approved',
  'ops approves the provider');

select test.assert_eq(
  (select count(*)::int from public.provider_verification_events
    where provider_id = 'e0000000-0000-4000-f000-000000000001'),
  1,
  'and the decision leaves a record — "the row says approved" answers nothing later');

select test.assert_eq(
  (select actor_id from public.provider_verification_events
    where provider_id = 'e0000000-0000-4000-f000-000000000001'),
  '11111111-0000-4000-f000-000000000001'::uuid,
  'naming who vouched for them');

-- Re-confirming is not an event.
select public.set_provider_verification('e0000000-0000-4000-f000-000000000001', 'approved');
select test.assert_eq(
  (select count(*)::int from public.provider_verification_events
    where provider_id = 'e0000000-0000-4000-f000-000000000001'),
  1,
  'setting the same status again records nothing — the history stays meaningful');


-- Taking it away needs a reason -------------------------------------------------
select test.assert_raises(
  $$select public.set_provider_verification('e0000000-0000-4000-f000-000000000001', 'suspended')$$,
  'a suspension without a stated reason is refused — the provider is told this and may appeal',
  '23514');

reset role;

-- Put them online first, so the side effect below has something to undo.
select public.begin_privileged_write();
update public.providers set is_online = true
 where id = 'e0000000-0000-4000-f000-000000000001';
insert into public.provider_locations (provider_id, location)
values ('e0000000-0000-4000-f000-000000000001',
        extensions.st_point(46.6760, 24.7150)::extensions.geography);
select public.end_privileged_write();

set role authenticated;
select test.become('11111111-0000-4000-f000-000000000001');

select public.set_provider_verification(
  'e0000000-0000-4000-f000-000000000001', 'suspended', 'شكوى موثّقة قيد التحقيق');

select test.assert_eq(
  (select is_online from public.providers where id = 'e0000000-0000-4000-f000-000000000001'),
  false,
  'a suspended provider is taken offline — otherwise they keep drawing offers they cannot accept');

select test.assert_eq(
  (select count(*)::int from public.provider_locations
    where provider_id = 'e0000000-0000-4000-f000-000000000001'),
  0,
  'and their broadcast position is cleared, not left behind');

reset role;


-- The provider can read their own history ---------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-f000-000000000002');

select test.assert_eq(
  (select count(*)::int from public.provider_verification_events),
  2,
  'the provider sees the decisions made about them — being rejected with no reason given is how an appeal becomes a support queue');

select test.become('33333333-0000-4000-f000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.provider_verification_events),
  0,
  'and nobody else does');


-- The record cannot be edited ---------------------------------------------------
select test.become('11111111-0000-4000-f000-000000000001');

-- Raises rather than quietly affecting zero rows: UPDATE was revoked outright,
-- so this fails at the privilege level before RLS is even consulted. Stronger
-- than a policy that filters, and it fails loudly if someone ever grants it.
select test.assert_raises(
  $$update public.provider_verification_events set note = 'something else'$$,
  'not even ops can rewrite the history — an audit trail that can be edited is not one',
  '42501');

reset role;

rollback;
