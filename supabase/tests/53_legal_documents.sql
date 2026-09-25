-- 53 — The terms, the privacy policy and the provider terms, as documents
--
-- Companion to 0083. A version is public, frozen and numbered by the database;
-- an acceptance is recorded by the database, for the version in force only.

\echo '── legal documents'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-5353-000000000001', '+966509530001'),  -- customer
  ('22222222-0000-4000-5353-000000000002', '+966509530002'),  -- provider applicant
  ('33333333-0000-4000-5353-000000000003', '+966509530003');  -- operator
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5353-000000000001', 'العميل', '+966509530001'),
  ('22222222-0000-4000-5353-000000000002', 'الفنّي', '+966509530002'),
  ('33333333-0000-4000-5353-000000000003', 'المشغّل', '+966509530003');
select test.grant_role('33333333-0000-4000-5353-000000000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-5353-000000000001', 'الدمام', 'DammamLegal', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.3927)::extensions.geography);


-- Version 1 ------------------------------------------------------------------------------
select test.assert_eq(
  (select string_agg(kind::text || ':' || version, ',' order by kind)
     from public.legal_documents),
  'terms:1,privacy:1,provider_terms:1', 'each document ships with version 1');

set role anon;
select test.assert_eq(
  (select count(*)::int from public.legal_documents), 3,
  'anyone can read them before signing in');
select test.assert_raises(
  $$insert into public.legal_documents (kind, body_ar, body_en)
    values ('terms', repeat('نص ', 50), repeat('text ', 50))$$,
  'but not publish one', '42501');
reset role;

select test.assert_raises(
  $$update public.legal_documents set body_ar = body_ar || ' تعديل' where kind = 'terms'$$,
  'a published version is never edited, not even by the owner', '42501');
select test.assert_raises(
  $$delete from public.legal_documents where kind = 'privacy'$$,
  'nor deleted', '42501');


-- Acceptance -----------------------------------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-5353-000000000001');

select test.assert_eq(
  (select string_agg(kind::text, ',' order by kind) from public.my_pending_legal_documents()),
  'terms,privacy', 'a new customer has the terms and the privacy policy to accept, not the provider terms');

select test.assert_raises(
  $$insert into public.legal_acceptances (user_id, document_id)
    select '11111111-0000-4000-5353-000000000001', id from public.legal_documents limit 1$$,
  'an acceptance cannot be written by hand', '42501');

select test.assert_eq(
  public.accept_legal_documents(array(select id from public.my_pending_legal_documents())), 2,
  'accepting records both');
select test.assert_eq(
  (select count(*)::int from public.my_pending_legal_documents()), 0,
  'and nothing is pending after');
select test.assert_eq(
  public.accept_legal_documents(array(select id from public.legal_documents where kind = 'terms')), 0,
  'accepting again records nothing new');
select test.assert_eq(
  (select count(*)::int from public.legal_acceptances), 2,
  'the customer sees their own acceptances');

select test.become('22222222-0000-4000-5353-000000000002');
select test.assert_eq(
  (select count(*)::int from public.legal_acceptances), 0, 'and nobody else''s');

-- Applying as a provider adds the provider terms.
insert into public.providers (owner_profile_id, provider_type, business_name_ar, city_id)
values ('22222222-0000-4000-5353-000000000002', 'individual', 'فنّي الدمام',
        'c0000000-0000-4000-5353-000000000001');
select test.assert_eq(
  (select string_agg(kind::text, ',' order by kind) from public.my_pending_legal_documents()),
  'terms,privacy,provider_terms', 'an applicant also has the provider terms to accept');

select test.assert_raises(
  $$select * from public.ops_legal_documents()$$, 'the console list is for operators', '42501');


-- A new version --------------------------------------------------------------------------
select test.become('33333333-0000-4000-5353-000000000003');

select test.assert_raises(
  $$insert into public.legal_documents (kind, body_ar, body_en, published_at)
    values ('terms', repeat('نص ', 50), repeat('text ', 50), now() - interval '1 day')$$,
  'a version cannot be dated in the past', '23514');

insert into public.legal_documents (kind, body_ar, body_en, summary_ar)
values ('terms', repeat('نص جديد ', 50), repeat('new text ', 50), 'تعديل رسوم الإلغاء');

select test.assert_eq(
  (select version from public.legal_documents where kind = 'terms' order by version desc limit 1), 2,
  'the database numbers it, whatever the console sends');
select test.assert_eq(
  (select created_by from public.legal_documents where kind = 'terms' and version = 2),
  '33333333-0000-4000-5353-000000000003'::uuid, 'and records who published it');
select test.assert_eq(
  (select count(*)::int from public.audit_log where target_table = 'legal_documents' and action = 'insert'), 1,
  'in the audit log too');
select test.assert_eq(
  (select acceptances::int || '/' || is_current from public.ops_legal_documents()
    where kind = 'terms' and version = 1),
  '1/false', 'the console sees who accepted version 1, and that it is no longer in force');

-- A change announced ahead is invisible until its day.
insert into public.legal_documents (kind, body_ar, body_en, published_at)
values ('privacy', repeat('نص لاحق ', 50), repeat('later text ', 50), now() + interval '14 days');

select test.become_anon();
set role anon;
select test.assert_eq(
  (select max(version) from public.legal_documents where kind = 'privacy'), 1,
  'a version dated ahead is not public yet');
reset role;
set role authenticated;

select test.become('11111111-0000-4000-5353-000000000001');
select test.assert_eq(
  (select string_agg(kind::text || ':' || version, ',') from public.my_pending_legal_documents()),
  'terms:2', 'the customer is asked to accept the new terms, and only them');
select test.assert_raises(
  $$select public.accept_legal_documents(
      array(select id from public.legal_documents where kind = 'terms' and version = 1))$$,
  'a replaced version cannot be accepted', '23514');
select public.accept_legal_documents(array(select id from public.my_pending_legal_documents()));

-- A correction that does not need everyone's agreement again.
select test.become('33333333-0000-4000-5353-000000000003');
insert into public.legal_documents (kind, body_ar, body_en, summary_ar, requires_acceptance)
values ('terms', repeat('نص مصحّح ', 50), repeat('fixed text ', 50), 'تصحيح إملائي', false);

select test.become('11111111-0000-4000-5353-000000000001');
select test.assert_eq(
  (select count(*)::int from public.my_pending_legal_documents()), 0,
  'a correction published without asking for acceptance asks nobody');

rollback;

\echo '   legal documents OK'
