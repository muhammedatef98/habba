-- 57 — KYC sealed in Vault, on the server
--
-- Companion to 0089. The values arrive once, are validated, and are kept only
-- as Vault secrets; the row holds a reference and a four-character tail. The
-- local Vault is a shim without encryption, so what this suite proves is the
-- flow and the privileges, not the cipher.

\echo '── kyc vault'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-5757-000000000001', '+966509570001'),  -- applicant
  ('22222222-0000-4000-5757-000000000002', '+966509570002'),  -- second applicant
  ('33333333-0000-4000-5757-000000000003', '+966509570003'),  -- operator
  ('44444444-0000-4000-5757-000000000004', '+966509570004');  -- workshop applicant
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5757-000000000001', 'المتقدّم', '+966509570001'),
  ('22222222-0000-4000-5757-000000000002', 'متقدّم آخر', '+966509570002'),
  ('33333333-0000-4000-5757-000000000003', 'المشغّل', '+966509570003'),
  ('44444444-0000-4000-5757-000000000004', 'صاحب الورشة', '+966509570004');
select test.grant_role('33333333-0000-4000-5757-000000000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-5757-000000000001', 'الخبر', 'KhobarKyc', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2172)::extensions.geography);

-- Validation, the same rules as @habba/core ---------------------------------------------
select test.assert(public.is_valid_saudi_national_id('1000000008'), 'a citizen ID with its check digit');
select test.assert(public.is_valid_saudi_national_id('2122334457'), 'an iqama with its check digit');
select test.assert(not public.is_valid_saudi_national_id('1000000009'), 'a typo in the last digit is caught');
select test.assert(not public.is_valid_saudi_national_id('3000000004'), 'only 1 and 2 lead');
select test.assert(public.is_valid_saudi_iban('SA0380000000608010167519'), 'a valid IBAN');
select test.assert(not public.is_valid_saudi_iban('SA0380000000608010167591'), 'a transposition fails mod-97');
select test.assert(not public.is_valid_saudi_iban('AE070331234567890123456'), 'only Saudi IBANs');
select test.assert_eq(public.normalise_kyc_digits(' sa03 8000 0000 6080 1016 7519 '),
  'SA0380000000608010167519', 'spaces and case are forgiven');
select test.assert_eq(public.normalise_kyc_digits('١٠٠٠٠٠٠٠٠٨'), '1000000008', 'so are Arabic-Indic digits');

-- Applying ------------------------------------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-5757-000000000001');

select test.assert_raises(
  $$insert into public.providers (owner_profile_id, provider_type, business_name_ar, city_id, national_id_encrypted)
    values ('11111111-0000-4000-5757-000000000001', 'individual', 'فنّي', 'c0000000-0000-4000-5757-000000000001', 'anything')$$,
  'a client cannot insert a provider row directly any more', '42501');

select test.assert_raises(
  $$select public.submit_provider_application('individual', 'فنّي الخبر',
      'c0000000-0000-4000-5757-000000000001', '1000000009', 'SA0380000000608010167519')$$,
  'a national ID with a wrong check digit is refused', '23514');
select test.assert_raises(
  $$select public.submit_provider_application('individual', 'فنّي الخبر',
      'c0000000-0000-4000-5757-000000000001', '1000000008', 'SA0380000000608010167591')$$,
  'an IBAN that fails mod-97 is refused', '23514');

select test.assert_eq(
  public.submit_provider_application('individual', 'فنّي الخبر',
    'c0000000-0000-4000-5757-000000000001', '١٠٠٠٠٠٠٠٠٨', 'sa03 8000 0000 6080 1016 7519') ->> 'verification_status',
  'pending', 'a valid application is accepted, pending review');

select test.assert_raises(
  $$select public.submit_provider_application('individual', 'مرة ثانية',
      'c0000000-0000-4000-5757-000000000001', '2122334457', 'SA0910000000000000000001')$$,
  'one application per account', '23505');

select test.assert_raises(
  $$select national_id_encrypted from public.providers$$,
  'the reference is not readable by the applicant either', '42501');
select test.assert_raises(
  $$select * from public.provider_identity_digests$$, 'nor is the digest table', '42501');
select test.assert_raises(
  $$select public.kyc_unseal('vault:00000000-0000-0000-0000-000000000000')$$,
  'nor can a client call the unseal helper', '42501');
select test.assert_raises(
  $$select public.ops_reveal_provider_kyc(
      (select id from public.providers where owner_profile_id = '11111111-0000-4000-5757-000000000001'), 'مراجعة')$$,
  'a provider cannot reveal their own sealed values through the console function', '42501');

select test.assert_raises(
  $$update public.providers set iban_tail = '0000'
     where owner_profile_id = '11111111-0000-4000-5757-000000000001'$$,
  'the sealed columns cannot be changed by the owner', '42501');

-- The same identity cannot back a second account.
select test.become('22222222-0000-4000-5757-000000000002');
select test.assert_raises(
  $$select public.submit_provider_application('individual', 'منتحل',
      'c0000000-0000-4000-5757-000000000001', '1000000008', 'SA0910000000000000000001')$$,
  'an identity already in use is refused', '23505');

-- A workshop needs its commercial registration.
select test.become('44444444-0000-4000-5757-000000000004');
select test.assert_raises(
  $$select public.submit_provider_application('workshop', 'ورشة الخبر',
      'c0000000-0000-4000-5757-000000000001', '2122334457', 'SA0820000000000000000002')$$,
  'a workshop without a CR is refused', '23514');
select test.assert_eq(
  public.submit_provider_application('workshop', 'ورشة الخبر',
    'c0000000-0000-4000-5757-000000000001', '2122334457', 'SA0820000000000000000002', '2050012345')
    ->> 'verification_status',
  'pending', 'with one, it is accepted');
reset role;

-- What is stored ------------------------------------------------------------------------
select test.assert(
  (select national_id_encrypted ~ '^vault:[0-9a-f-]{36}$' and iban_encrypted ~ '^vault:[0-9a-f-]{36}$'
     from public.providers where owner_profile_id = '11111111-0000-4000-5757-000000000001'),
  'the row holds references, not values');
select test.assert(
  (select identity_kind = 'national' and national_id_tail = '0008' and iban_tail = '7519'
     from public.providers where owner_profile_id = '11111111-0000-4000-5757-000000000001'),
  'plus the kind and the tails support may quote');
select test.assert(
  (select identity_kind = 'iqama' from public.providers
    where owner_profile_id = '44444444-0000-4000-5757-000000000004'),
  'an iqama is recorded as one');
select test.assert(
  (select count(*) = 0 from public.providers where national_id_encrypted like '%1000000008%'
      or iban_encrypted like '%7519%'),
  'the plain values appear nowhere on the row');
select test.assert(
  (select count(*) = 1 from vault.decrypted_secrets where decrypted_secret = '1000000008'),
  'the value itself is in Vault, normalised');

-- An operator reads it back, and that is audited ------------------------------------------
set role authenticated;
select test.become('33333333-0000-4000-5757-000000000003');
select test.assert_raises(
  $$select public.ops_reveal_provider_kyc(
      (select id from public.providers where owner_profile_id = '11111111-0000-4000-5757-000000000001'), '')$$,
  'a reveal needs a reason', '23514');

select public.ops_reveal_provider_kyc(
  (select id from public.providers where owner_profile_id = '11111111-0000-4000-5757-000000000001'),
  'التحقق من الهوية قبل الاعتماد') as revealed \gset
select test.assert(:'revealed'::jsonb ->> 'national_id' = '1000000008'
                   and :'revealed'::jsonb ->> 'iban' = 'SA0380000000608010167519'
                   and (:'revealed'::jsonb ->> 'legacy')::boolean = false,
  'an operator can read the values back');
reset role;

select test.assert(
  (select count(*) = 1 from public.audit_log
    where actor_id = '33333333-0000-4000-5757-000000000003'
      and action = 'read' and target_table = 'providers'
      and after ->> 'kyc_revealed' = 'true'
      and after ->> 'reason' = 'التحقق من الهوية قبل الاعتماد'),
  'the reveal is audited, with its reason');
select test.assert(
  (select count(*) = 0 from public.audit_log
    where after::text like '%1000000008%' or after::text like '%SA0380000000608010167519%'
       or before::text like '%1000000008%'),
  'and the audit never holds the values');

-- A rejected applicant applies again ------------------------------------------------------
set role authenticated;
select test.become('33333333-0000-4000-5757-000000000003');
select public.set_provider_verification(
  (select id from public.providers where owner_profile_id = '44444444-0000-4000-5757-000000000004'),
  'rejected', 'السجل التجاري لا يطابق الاسم');

select test.become('44444444-0000-4000-5757-000000000004');
select test.assert_eq(
  public.submit_provider_application('workshop', 'ورشة الخبر الحديثة',
    'c0000000-0000-4000-5757-000000000001', '2122334457', 'SA0910000000000000000001', '2050012346')
    ->> 'verification_status',
  'pending', 'after a rejection, applying again is accepted');
reset role;

select test.assert(
  (select count(*) = 1 and bool_and(business_name_ar = 'ورشة الخبر الحديثة' and iban_tail = '0001')
     from public.providers where owner_profile_id = '44444444-0000-4000-5757-000000000004'),
  'it replaces the rejected record rather than adding a second one');
select test.assert(
  (select count(*) = 0 from vault.decrypted_secrets where decrypted_secret = 'SA0820000000000000000002'),
  'and the rejected IBAN is destroyed');
select test.assert(
  (select count(*) = 1 from public.provider_verification_events e
     join public.providers p on p.id = e.provider_id
    where p.owner_profile_id = '44444444-0000-4000-5757-000000000004'
      and e.from_status = 'rejected' and e.to_status = 'pending'),
  'and the history shows it came back');

-- Erasure destroys them ------------------------------------------------------------------
select public.erase_account('11111111-0000-4000-5757-000000000001', 'اختبار', '33333333-0000-4000-5757-000000000003');
select test.assert(
  (select national_id_encrypted is null and iban_encrypted is null and national_id_tail is null
     from public.providers where owner_profile_id = '11111111-0000-4000-5757-000000000001'),
  'erasing the account clears the references');
select test.assert(
  (select count(*) = 0 from vault.decrypted_secrets
    where decrypted_secret in ('1000000008', 'SA0380000000608010167519')),
  'and deletes the secrets themselves');
select test.assert(
  (select count(*) = 1 from public.provider_identity_digests),
  'and the digest, so only the workshop''s remains');

rollback;

\echo '   kyc vault OK'
