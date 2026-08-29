-- 17 — Read-surface hardening, plus a standing audit of column-level grants
--
-- Mirrors 16: the first half proves the specific 0037 fixes behave correctly;
-- the second half turns the underlying class of bug into a build step, the
-- same way 16 did for column-level UPDATE control.
--
-- The class here is narrower but sneakier than the write side: a column-level
-- REVOKE is a silent no-op against a role that still holds table-level
-- SELECT, because the table-level grant is a superset. `information_schema`
-- inspection alone can miss this; `has_column_privilege()` reports the true
-- effective privilege and is what both halves of this file use.

\echo '── read surface: providers KYC columns'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-7777-000000000001', '+966509300001'),
  ('22222222-0000-4000-7777-000000000002', '+966509300002');

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-7777-000000000001', 'صاحب الورشة', '+966509300001', 'technician'),
  ('22222222-0000-4000-7777-000000000002', 'زبون', '+966509300002', 'customer');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-7777-000000000001', 'ر', 'CityKyc', 'ر', 'R',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id,
   national_id_encrypted, iban_encrypted, cr_number, vat_number)
values
  ('e0000000-0000-4000-7777-000000000001', '11111111-0000-4000-7777-000000000001',
   'individual', 'ورشة الاختبار', 'approved', 'c0000000-0000-4000-7777-000000000001',
   'CIPHERTEXT_NID', 'CIPHERTEXT_IBAN', '1010555555', '300000000000003');

set role authenticated;

-- Neither a stranger nor the provider's own owner can read the KYC columns
-- through the client role. The column was pulled off the grant entirely
-- rather than scoped by row, so this applies uniformly — see the migration
-- comment on why the client never needs the raw value back.
select test.become('22222222-0000-4000-7777-000000000002');
select test.assert_raises(
  $$select national_id_encrypted from public.providers
    where id = 'e0000000-0000-4000-7777-000000000001'$$,
  'a stranger cannot select national_id_encrypted',
  '42501');
select test.assert_raises(
  $$select iban_encrypted from public.providers
    where id = 'e0000000-0000-4000-7777-000000000001'$$,
  'a stranger cannot select iban_encrypted',
  '42501');

select test.become('11111111-0000-4000-7777-000000000001');
select test.assert_raises(
  $$select national_id_encrypted from public.providers
    where id = 'e0000000-0000-4000-7777-000000000001'$$,
  'the provider''s own owner cannot select it either — the column is off the client surface entirely',
  '42501');

-- Ordinary discovery columns are unaffected.
select test.become('22222222-0000-4000-7777-000000000002');
select test.assert_eq(
  (select business_name_ar from public.providers
   where id = 'e0000000-0000-4000-7777-000000000001'),
  'ورشة الاختبار',
  'public discovery columns are still readable');

reset role;
rollback;

\echo '   providers KYC columns OK'


\echo '── read surface: ownership transfer verified-phone gate'

-- profiles.phone is UNIQUE (0005) — the attacker and the legitimate
-- recipient can never hold the same number at once, so the self-declare
-- attack and the honest discovery path are exercised as two independent
-- scenarios rather than a race for one phone value.

begin;

insert into auth.users (id, phone) values
  ('33333333-0000-4000-7777-000000000001', '+966509300010'),
  ('55555555-0000-4000-7777-000000000003', '+966509300012');

insert into public.profiles (id, full_name, phone, phone_verified, role) values
  ('33333333-0000-4000-7777-000000000001', 'البائع', '+966509300010', true, 'customer'),
  ('55555555-0000-4000-7777-000000000003', 'المهاجم', '+966509300012', true, 'customer');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-7777-000000000001', 'م', 'MakeXfer');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-7777-000000000001', 'a0000000-0000-4000-7777-000000000001',
   'م', 'ModelXfer', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-7777-000000000001', '33333333-0000-4000-7777-000000000001',
   'a0000000-0000-4000-7777-000000000001', 'b0000000-0000-4000-7777-000000000001',
   2020, 'ABJ 77');

-- The transfer targets a phone with no profile yet — the exact "recipient
-- has no account" case the phone match exists to serve, and the exact
-- window the old policy left open.
insert into public.ownership_transfers
  (id, vehicle_id, from_owner_id, to_phone, otp_code_hash, expires_at, created_by)
values
  ('70000000-0000-4000-7777-000000000001', 'd0000000-0000-4000-7777-000000000001',
   '33333333-0000-4000-7777-000000000001', '+966509300011',
   encode(sha256(convert_to('481923', 'UTF8')), 'hex'),
   now() + interval '1 day', '33333333-0000-4000-7777-000000000001');

set role authenticated;

-- The attacker claims the unregistered target phone. The unique constraint
-- does not stop them — nobody holds it yet — but 0036's guard resets
-- phone_verified to false the moment the number changes, and the new policy
-- requires phone_verified, not merely a match.
select test.become('55555555-0000-4000-7777-000000000003');
update public.profiles set phone = '+966509300011'
where id = '55555555-0000-4000-7777-000000000003';

select test.assert(
  not (select phone_verified from public.profiles
       where id = '55555555-0000-4000-7777-000000000003'),
  'claiming another number leaves it unverified, exactly as 0036 intends');

select test.assert_eq(
  (select count(*)::int from public.ownership_transfers),
  0,
  'an unverified phone claim grants no visibility into the pending transfer, otp hash included');

reset role;
rollback;

\echo '   ownership transfer verified-phone gate OK'


\echo '── read surface: ownership transfer acceptance'

begin;

insert into auth.users (id, phone) values
  ('33333333-0000-4000-7777-000000000004', '+966509300013'),
  ('44444444-0000-4000-7777-000000000005', '+966509300014');

-- The recipient's phone_verified = true here stands in for Supabase Auth's
-- own SMS verification having already run before this profile existed — not
-- something this policy grants, only something it now requires.
insert into public.profiles (id, full_name, phone, phone_verified, role) values
  ('33333333-0000-4000-7777-000000000004', 'البائع', '+966509300013', true, 'customer'),
  ('44444444-0000-4000-7777-000000000005', 'المشتري', '+966509300014', true, 'customer');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-7777-000000000002', 'م', 'MakeXfer2');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-7777-000000000002', 'a0000000-0000-4000-7777-000000000002',
   'م', 'ModelXfer2', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-7777-000000000002', '33333333-0000-4000-7777-000000000004',
   'a0000000-0000-4000-7777-000000000002', 'b0000000-0000-4000-7777-000000000002',
   2020, 'ABJ 78');

insert into public.ownership_transfers
  (id, vehicle_id, from_owner_id, to_phone, otp_code_hash, expires_at, created_by)
values
  ('70000000-0000-4000-7777-000000000002', 'd0000000-0000-4000-7777-000000000002',
   '33333333-0000-4000-7777-000000000004', '+966509300014',
   encode(sha256(convert_to('481923', 'UTF8')), 'hex'),
   now() + interval '1 day', '33333333-0000-4000-7777-000000000004');

set role authenticated;

-- The real recipient, whose phone was verified before the transfer was ever
-- created, can see it — this is the discovery UX the policy exists for.
select test.become('44444444-0000-4000-7777-000000000005');
select test.assert_eq(
  (select otp_code_hash from public.ownership_transfers
   where id = '70000000-0000-4000-7777-000000000002'),
  encode(sha256(convert_to('481923', 'UTF8')), 'hex'),
  'the verified recipient can discover the transfer waiting for them');

-- Wrong code is rejected without consuming the transfer.
select test.assert_raises(
  $$select public.accept_ownership_transfer(
      '70000000-0000-4000-7777-000000000002', '000000')$$,
  'the wrong code is rejected',
  '28P01');

select test.assert_eq(
  (select status from public.ownership_transfers
   where id = '70000000-0000-4000-7777-000000000002'),
  'pending'::ownership_transfer_status,
  'a failed attempt leaves the transfer pending');

-- The correct code transfers ownership, records the timeline event, and
-- flips status so a repeat cannot replay it.
select public.accept_ownership_transfer(
  '70000000-0000-4000-7777-000000000002', '481923');

select test.assert_eq(
  (select owner_id from public.vehicles
   where id = 'd0000000-0000-4000-7777-000000000002'),
  '44444444-0000-4000-7777-000000000005'::uuid,
  'ownership moved to the accepting recipient');

select test.assert_eq(
  (select status from public.ownership_transfers
   where id = '70000000-0000-4000-7777-000000000002'),
  'accepted'::ownership_transfer_status,
  'the transfer is marked accepted');

select test.assert(
  exists (
    select 1 from public.vehicle_timeline
    where vehicle_id = 'd0000000-0000-4000-7777-000000000002'
      and event_type = 'ownership_transferred'
  ),
  'the logbook records that the car changed hands');

select test.assert_raises(
  $$select public.accept_ownership_transfer(
      '70000000-0000-4000-7777-000000000002', '481923')$$,
  'an already-accepted transfer cannot be replayed',
  'P0002');

reset role;
rollback;

\echo '   ownership transfer acceptance OK'


\echo '── read surface: commission rates are ops-only'

begin;

insert into auth.users (id, phone) values
  ('66666666-0000-4000-7777-000000000001', '+966509300020');
insert into public.profiles (id, full_name, phone, role) values
  ('66666666-0000-4000-7777-000000000001', 'زبون', '+966509300020', 'customer');

set role authenticated;
select test.become('66666666-0000-4000-7777-000000000001');

select test.assert_eq(
  (select count(*)::int from public.commission_rates),
  0,
  'an ordinary customer cannot read the commission table at all');

reset role;
rollback;

\echo '   commission rates ops-only OK'


-- ===========================================================================
-- Standing audit: sensitive columns stay off the client SELECT surface
-- ===========================================================================
-- The write-side audit (16) checks that a table has a guard trigger. There is
-- no equivalent trigger concept for SELECT, so this checks the actual grant
-- with has_column_privilege() — the function that accounts for a table-level
-- grant overriding a column-level revoke, which a naive information_schema
-- query would miss (proven while building this fix: a bare column REVOKE
-- left the column readable, because pg_catalog and PostgREST both apply the
-- table-wide grant when it exists at all).

\echo '── standing audit: no-select column list'

begin;

create temporary table no_select_columns (table_name text, column_name text)
  on commit drop;
insert into no_select_columns values
  ('providers', 'national_id_encrypted'),
  ('providers', 'iban_encrypted');

select test.assert_eq(
  (select coalesce(string_agg(c.table_name || '.' || c.column_name, ', '), '(none)')
   from no_select_columns c
   where has_column_privilege('authenticated', ('public.' || c.table_name)::regclass,
                               c.column_name, 'SELECT')
      or has_column_privilege('anon', ('public.' || c.table_name)::regclass,
                               c.column_name, 'SELECT')),
  '(none)',
  'no client role can select a column on the no-select list, table grant or column grant alike');

-- The inverse belt-and-braces check: catch a rename or drop that would let
-- this audit pass for the wrong reason (the column no longer exists at all).
select test.assert_eq(
  (select coalesce(string_agg(c.table_name || '.' || c.column_name, ', '), '(none)')
   from no_select_columns c
   where not exists (
     select 1 from information_schema.columns col
     where col.table_schema = 'public'
       and col.table_name = c.table_name
       and col.column_name = c.column_name
   )),
  '(none)',
  'every column on the no-select list still exists (a rename must be re-audited)');

rollback;

\echo '   no-select column list OK'
