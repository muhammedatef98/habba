-- 70 — The handover code is checked, and ops hold the new switches
--
-- Companion to 0106.

\echo '── handover code and switches'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-7070-000000000001', '+966509700001'),
  ('22222222-0000-4000-7070-000000000002', '+966509700002'),
  ('66666666-0000-4000-7070-000000000006', '+966509700006');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-7070-000000000001', 'العميل', '+966509700001'),
  ('22222222-0000-4000-7070-000000000002', 'الفنّي', '+966509700002'),
  ('66666666-0000-4000-7070-000000000006', 'التشغيل', '+966509700006');
select test.grant_role('66666666-0000-4000-7070-000000000006', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-7070-000000000001', 'الدمام', 'DammamHandover', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-7070-000000000001', 'ماركة', 'TestMakeHandover');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-7070-000000000001', 'a0000000-0000-4000-7070-000000000001',
   'موديل', 'TestModelHandover', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-7070-000000000001', '11111111-0000-4000-7070-000000000001',
   'a0000000-0000-4000-7070-000000000001', 'b0000000-0000-4000-7070-000000000001',
   2022, 'ABD 7070', 30000);
insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-7070-000000000001', '22222222-0000-4000-7070-000000000002',
   'individual', 'فنّي', 'approved', true, 'c0000000-0000-4000-7070-000000000001', 90);
select test.grant_role('22222222-0000-4000-7070-000000000002', 'technician');
select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-7070-000000000001', :'svc_battery');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-7070-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

update public.platform_settings set value = 'true' where key = 'require_handover_code';

select test.become('11111111-0000-4000-7070-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-7070-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 30100) as job \gset
select public.authorise_order_payment(:'job', 'intent_handover_1');
select public.submit_order(:'job');

select test.become('22222222-0000-4000-7070-000000000002');
select public.accept_order(:'job');
update public.orders set status = 'en_route' where id = :'job';
update public.orders set status = 'arrived' where id = :'job';

select test.assert_raises(
  format($$update public.orders set status = 'in_progress' where id = '%s'$$, :'job'),
  'with the switch on, work cannot start before the code', '23514');

select test.assert(
  (select issued and not verified and not locked from public.handover_status(:'job')),
  'the technician can see a code is waiting, without seeing it');
select code as the_code from public.order_handovers where order_id = :'job' \gset
select test.assert(not public.verify_handover_code(:'job', '0000x'), 'a wrong code is refused');
select test.assert(public.verify_handover_code(:'job', :'the_code'), 'the right code is accepted');
select test.assert((select verified from public.handover_status(:'job')), 'and it reads as verified');
update public.orders set status = 'in_progress' where id = :'job';
select test.assert_eq((select status::text from public.orders where id = :'job'), 'in_progress',
  'and then work starts');

-- A second job whose code gets locked, then re-issued by ops.
select test.become('11111111-0000-4000-7070-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-7070-000000000001',
  'حي الشاطئ', 'مرة ثانية', 30200) as job2 \gset
select public.authorise_order_payment(:'job2', 'intent_handover_2');
select public.submit_order(:'job2');
select test.become('22222222-0000-4000-7070-000000000002');
select public.accept_order(:'job2');
select public.verify_handover_code(:'job2', 'nope') from generate_series(1, 5);
select test.assert_raises(
  format($$select public.verify_handover_code('%s', 'nope')$$, :'job2'),
  'five wrong guesses lock it', '23514');
select test.assert((select locked from public.handover_status(:'job2')), 'and it reads as locked');
select test.assert_raises(
  format($$select public.ops_reissue_handover('%s', 'العميل اتصل بالدعم')$$, :'job2'),
  'a technician cannot re-issue it', '42501');

select test.become('66666666-0000-4000-7070-000000000006');
select test.assert_raises(
  format($$select public.ops_reissue_handover('%s', '')$$, :'job2'),
  'ops need a reason', '23514');
select public.ops_reissue_handover(:'job2', 'العميل اتصل بالدعم');
select test.assert_eq((select attempts from public.order_handovers where order_id = :'job2'), 0,
  'ops re-issue a fresh code');
select test.assert(
  exists (select 1 from public.audit_log where target_table = 'order_handovers'
           and target_id = :'job2' and after ->> 'reason' = 'العميل اتصل بالدعم'
           and not (after ? 'code')),
  'on the record with the reason, and without the code');

-- The switches.
update public.platform_settings set value = 'false' where key = 'feature_order_chat';
select test.become('22222222-0000-4000-7070-000000000002');
select test.assert_raises(
  format($$select public.send_order_message('%s', 'مرحبا')$$, :'job'),
  'with chat switched off, messages are refused', '23514');

update public.platform_settings set value = 'false' where key = 'feature_warranty_claims';
select test.become('11111111-0000-4000-7070-000000000001');
select test.assert_raises(
  format($$select public.request_warranty_service('%s', 'البطارية فصلت مرة ثانية')$$, :'job'),
  'with claims switched off, a claim is refused before anything else', '23514');

rollback;
