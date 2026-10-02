-- 52 — The terms, the privacy policy, and how long a report lives
--
-- Companion to 0082.

\echo '── legal links'

begin;

select test.assert(
  (select get_public_settings ?& array['terms_url', 'privacy_url'] from public.get_public_settings()),
  'the app can read both links before anyone signs in');

update public.platform_settings set value = '"https://habba.sa/terms"' where key = 'terms_url';
select test.assert_eq(
  (select get_public_settings ->> 'terms_url' from public.get_public_settings()),
  'https://habba.sa/terms', 'a link set in the console is what the app reads');

select test.assert_raises(
  $$update public.platform_settings set value = '"http://habba.sa/privacy"' where key = 'privacy_url'$$,
  'a link that is not https is refused', '23514');
select test.assert_raises(
  $$update public.platform_settings set value = '"javascript:alert(1)"' where key = 'privacy_url'$$,
  'and so is anything that is not a link', '23514');
select test.assert_raises(
  $$update public.platform_settings set value = '"https://"' where key = 'app_store_url'$$,
  'the store links follow the same rule', '23514');

update public.platform_settings set value = '""' where key = 'terms_url';
select test.assert_eq(
  (select value #>> '{}' from public.platform_settings where key = 'terms_url'), '',
  'an empty link is allowed: it means "not published yet"');

-- The report's lifetime -----------------------------------------------------------
insert into auth.users (id, phone) values ('11111111-0000-4000-5252-000000000001', '+966509520001');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5252-000000000001', 'المالك', '+966509520001');
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-5252-000000000001', 'ماركة', 'TestMakeLegal');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-5252-000000000001', 'a0000000-0000-4000-5252-000000000001',
   'موديل', 'TestModelLegal', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-5252-000000000001', '11111111-0000-4000-5252-000000000001',
   'a0000000-0000-4000-5252-000000000001', 'b0000000-0000-4000-5252-000000000001',
   2021, 'KND 5252');

select test.assert(
  (select not is_public from public.platform_settings where key = 'habba_report_valid_days'),
  'the report lifetime is an operator setting, not published to the app');

update public.platform_settings set value = '30' where key = 'habba_report_valid_days';

set role authenticated;
select test.become('11111111-0000-4000-5252-000000000001');
select public.generate_habba_report('d0000000-0000-4000-5252-000000000001') as tok \gset
reset role;

select test.assert_eq(
  (select (expires_at - generated_at)::text from public.habba_reports where public_token = :'tok'),
  '30 days', 'a new report lives as long as the console says');

update public.platform_settings set value = '90' where key = 'habba_report_valid_days';
select test.assert_eq(
  (select (expires_at - generated_at)::text from public.habba_reports where public_token = :'tok'),
  '30 days', 'and keeps that lifetime when the setting changes later');

rollback;

\echo '   legal links OK'
