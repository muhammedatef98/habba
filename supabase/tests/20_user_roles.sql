-- 20 — Roles as a join table (migration 0040, CLAUDE.md §5.1)
--
-- What this proves, in the order the amendment states it:
--
--   §5.1.1  everyone signs up as customer, and only approval grants provider
--   §5.1.2  a user may hold several roles, and revocation keeps history
--   §5.1.3  a customer-only user cannot reach a provider surface, and cannot
--           grant themselves anything — with raw SQL, not through the app
--
-- The A6 assertions that go through real HTTP and a real JWT live in
-- tests/rls.spec.ts. This suite is the same claims at the SQL layer; both
-- matter, because a policy can be right in psql and wrong through PostgREST.

\echo '── user roles'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-a000-000000000001', '+966507000001'),  -- stays a customer
  ('22222222-0000-4000-a000-000000000002', '+966507000002'),  -- becomes a technician
  ('33333333-0000-4000-a000-000000000003', '+966507000003');  -- workshop owner

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-a000-000000000001', 'مالك سيارة', '+966507000001'),
  ('22222222-0000-4000-a000-000000000002', 'فنّي',        '+966507000002'),
  ('33333333-0000-4000-a000-000000000003', 'صاحب ورشة',  '+966507000003');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-a000-000000000001', 'الخبر', 'CityRoles', 'المنطقة الشرقية',
   'Eastern Province', extensions.st_point(50.2083, 26.2794)::extensions.geography);


-- 1. Signup grants exactly one role, and it is customer -----------------------
select test.assert_eq(
  (select count(*)::int from public.user_roles
   where user_id = '11111111-0000-4000-a000-000000000001'),
  1, 'a new profile gets exactly one role');

select test.assert(
  public.has_role('11111111-0000-4000-a000-000000000001', 'customer'),
  'and that role is customer — no role question was asked (§5.1.1)');

select test.assert(
  not public.is_provider('11111111-0000-4000-a000-000000000001'),
  'a fresh signup is not a provider');


-- 2. A pending provider record grants nothing ---------------------------------
insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, national_id_encrypted,
   verification_status, city_id)
values
  ('e0000000-0000-4000-a000-000000000002', '22222222-0000-4000-a000-000000000002',
   'individual', 'ورشة متنقلة', 'enc:1010101010',
   'pending', 'c0000000-0000-4000-a000-000000000001');

select test.assert(
  not public.is_provider('22222222-0000-4000-a000-000000000002'),
  'applying does not make you a provider — pending grants nothing');

select public.begin_privileged_write();
update public.providers set verification_status = 'in_review'
where id = 'e0000000-0000-4000-a000-000000000002';
select public.end_privileged_write();

select test.assert(
  not public.is_provider('22222222-0000-4000-a000-000000000002'),
  'nor does being in review');


-- 3. Approval grants it, in the same transaction ------------------------------
select public.test_approve_provider('e0000000-0000-4000-a000-000000000002');

select test.assert(
  public.has_role('22222222-0000-4000-a000-000000000002', 'technician'),
  'approval grants the technician role (§5.1.1)');

select test.assert_eq(
  (select count(*)::int from public.user_roles
   where user_id = '22222222-0000-4000-a000-000000000002' and revoked_at is null),
  2, 'and they keep customer — a technician owns a car too');

select test.assert_eq(
  (select granted_by from public.user_roles
   where user_id = '22222222-0000-4000-a000-000000000002' and role = 'technician'),
  null::uuid, 'a system grant records no human grantor');


-- 4. A workshop gets the workshop role, not the technician one ----------------
insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('e0000000-0000-4000-a000-000000000003', '33333333-0000-4000-a000-000000000003',
   'workshop', 'ورشة الخبر', '1010888888',
   'approved', 'c0000000-0000-4000-a000-000000000001');

select test.assert(
  public.has_role('33333333-0000-4000-a000-000000000003', 'workshop_admin'),
  'an approved workshop grants workshop_admin');

select test.assert(
  not public.has_role('33333333-0000-4000-a000-000000000003', 'technician'),
  'and not technician — the two are different surfaces');


-- 5. Suspension revokes, and revocation is history, not deletion --------------
select public.begin_privileged_write();
update public.providers set verification_status = 'suspended'
where id = 'e0000000-0000-4000-a000-000000000002';
select public.end_privileged_write();

select test.assert(
  not public.is_provider('22222222-0000-4000-a000-000000000002'),
  'suspension revokes provider access immediately, with no client action');

select test.assert_eq(
  (select count(*)::int from public.user_roles
   where user_id = '22222222-0000-4000-a000-000000000002' and role = 'technician'),
  1, 'the grant row survives revocation — the history is the audit trail');

select test.assert(
  (select revoked_at is not null from public.user_roles
   where user_id = '22222222-0000-4000-a000-000000000002' and role = 'technician'),
  'revocation is a timestamp, never a DELETE (§5.1.2)');

select test.assert(
  public.has_role('22222222-0000-4000-a000-000000000002', 'customer'),
  'and the suspended technician is still a customer with a logbook');

-- Re-approval grants again, as a second row rather than an overwrite.
select public.test_approve_provider('e0000000-0000-4000-a000-000000000002');

select test.assert(
  public.is_provider('22222222-0000-4000-a000-000000000002'),
  're-approval restores the role');

select test.assert_eq(
  (select count(*)::int from public.user_roles
   where user_id = '22222222-0000-4000-a000-000000000002' and role = 'technician'),
  2, 'as a new grant row, so both grants remain visible');


-- 6. current_provider_id() answers only for approved records ------------------
-- Before 0040 it matched any providers row, so a self-registered applicant
-- held provider RLS access before anyone read their ID.
insert into auth.users (id, phone) values
  ('44444444-0000-4000-a000-000000000004', '+966507000004');
insert into public.profiles (id, full_name, phone) values
  ('44444444-0000-4000-a000-000000000004', 'متقدّم', '+966507000004');
insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, national_id_encrypted,
   verification_status, city_id)
values
  ('e0000000-0000-4000-a000-000000000004', '44444444-0000-4000-a000-000000000004',
   'individual', 'تحت المراجعة', 'enc:1020202020',
   'pending', 'c0000000-0000-4000-a000-000000000001');

set role authenticated;
select test.become('44444444-0000-4000-a000-000000000004');

select test.assert_eq(
  public.current_provider_id(), null::uuid,
  'a pending applicant has no provider identity at all');

select test.assert_eq(
  (select count(*)::int from public.list_open_orders_for_provider()),
  0, 'and therefore sees no open orders');

reset role;


-- 7. A customer-only user cannot grant themselves anything --------------------
set role authenticated;
select test.become('11111111-0000-4000-a000-000000000001');

select test.assert_raises(
  $$insert into public.user_roles (user_id, role)
    values ('11111111-0000-4000-a000-000000000001', 'technician')$$,
  'a customer cannot grant themselves technician',
  '42501');

select test.assert_raises(
  $$select public.grant_user_role('11111111-0000-4000-a000-000000000001', 'ops', null)$$,
  'nor call grant_user_role() — execute is revoked from authenticated',
  '42501');

-- Reading is scoped to yourself: knowing who the operators are is a target list.
select test.assert_eq(
  (select count(*)::int from public.user_roles),
  1, 'a user reads only their own roles');

reset role;

rollback;

\echo '   user roles OK'
