-- 09 — Inspections and buyer → owner conversion
--
-- Phase 5 acceptance: "a pre-purchase inspection produces a shareable report;
-- if the buyer purchases, the report converts into a new vehicles row with the
-- inspection as its first timeline event."

\echo '── inspections'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-b000-000000000001', '+966504000001'),  -- buyer
  ('22222222-0000-4000-b000-000000000002', '+966504000002'),  -- inspector
  ('33333333-0000-4000-b000-000000000003', '+966504000003');  -- someone else

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-b000-000000000001', 'المشتري', '+966504000001', 'customer'),
  ('22222222-0000-4000-b000-000000000002', 'الفاحص',  '+966504000002', 'technician'),
  ('33333333-0000-4000-b000-000000000003', 'شخص آخر', '+966504000003', 'customer');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-b000-000000000001', 'جدة', 'JeddahInsp', 'مكة', 'Makkah',
   extensions.st_point(39.1925, 21.4858)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-b000-000000000001', 'ماركة فحص', 'TestMakeInsp');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-b000-000000000001', 'a0000000-0000-4000-b000-000000000001',
   'موديل فحص', 'TestModelInsp', 2015);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-b000-000000000001', '22222222-0000-4000-b000-000000000002',
   'individual', 'مركز الفحص', 'approved', 'c0000000-0000-4000-b000-000000000001');

select id as svc from public.services where name_en = 'Pre-purchase inspection' \gset

-- The one service that runs against a car nobody owns.
select test.assert(
  not (select requires_vehicle from public.services where id = :'svc'),
  'the pre-purchase inspection does not require an owned vehicle');

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-b000-000000000001', :'svc');


-- An order with NO vehicle -----------------------------------------------------
select test.become('11111111-0000-4000-b000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   service_location, service_address_ar, provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-b000-000000000001',
   '11111111-0000-4000-b000-000000000001',
   null,                                   -- the buyer does not own this car
   :'svc', 'mobile_scheduled', 'draft',
   extensions.st_point(39.1930, 21.4860)::extensions.geography,
   'معرض السيارات، طريق الملك',
   'e0000000-0000-4000-b000-000000000001', 350, '11111111-0000-4000-b000-000000000001');

select public.authorise_order_payment('f0000000-0000-4000-b000-000000000001', 'insp_intent_1');
update public.orders set status = 'accepted' where id = 'f0000000-0000-4000-b000-000000000001';
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-b000-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-b000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-b000-000000000001';


-- Filing the report --------------------------------------------------------------
select test.become('22222222-0000-4000-b000-000000000002');

-- An incomplete inspection is refused. A partial report that still produces a
-- score looks complete to a buyer while omitting whatever was skipped.
select test.assert_raises(
  $$select public.submit_inspection_report(
      'f0000000-0000-4000-b000-000000000001', 'pre_purchase_v1',
      '{"engine":{"oil_leaks":{"rating":"pass"}}}'::jsonb,
      '1HGBH41JXMN109186')$$,
  'an inspection missing required items is refused',
  '23514');

-- A full pass on everything.
select public.submit_inspection_report(
  'f0000000-0000-4000-b000-000000000001',
  'pre_purchase_v1',
  (select jsonb_object_agg(
     s ->> 'key',
     (select jsonb_object_agg(i ->> 'key', jsonb_build_object('rating', 'pass'))
      from jsonb_array_elements(s -> 'items') as i)
   )
   from public.inspection_templates t,
        jsonb_array_elements(t.sections) as s
   where t.key = 'pre_purchase_v1'),
  '1HGBH41JXMN109186', 'ABJ 3333', 'تويوتا', 'كامري', 2018, 120000
) as report_id \gset

select test.assert_eq(
  (select overall_score from public.inspection_reports where id = :'report_id'),
  100, 'an all-pass inspection scores 100');

select test.assert_eq(
  (select recommendation from public.inspection_reports where id = :'report_id'),
  'buy'::inspection_recommendation, 'a 100 scores a buy recommendation');

select test.assert(
  (select vehicle_id from public.inspection_reports where id = :'report_id') is null,
  'a pre-purchase report has no vehicle_id — nobody owns the car yet');


-- Weighting actually bites ---------------------------------------------------------
-- A car that is perfect except for chassis damage and a deployed airbag must
-- not score like a car with a worn seat. This is the difference between a
-- score a buyer can act on and a reassuring number.
select public.score_inspection(
  (select id from public.inspection_templates where key = 'pre_purchase_v1'),
  (select jsonb_object_agg(
     s ->> 'key',
     (select jsonb_object_agg(
        i ->> 'key',
        jsonb_build_object('rating',
          case when (s ->> 'key') in ('body_chassis','history') then 'fail' else 'pass' end))
      from jsonb_array_elements(s -> 'items') as i)
   )
   from public.inspection_templates t, jsonb_array_elements(t.sections) as s
   where t.key = 'pre_purchase_v1')
) as structural_score \gset

select public.score_inspection(
  (select id from public.inspection_templates where key = 'pre_purchase_v1'),
  (select jsonb_object_agg(
     s ->> 'key',
     (select jsonb_object_agg(
        i ->> 'key',
        jsonb_build_object('rating',
          case when (s ->> 'key') = 'interior' then 'fail' else 'pass' end))
      from jsonb_array_elements(s -> 'items') as i)
   )
   from public.inspection_templates t, jsonb_array_elements(t.sections) as s
   where t.key = 'pre_purchase_v1')
) as cosmetic_score \gset

select test.assert(
  (:'structural_score')::int < (:'cosmetic_score')::int - 20,
  'chassis and accident-history failures cost far more than cosmetic ones');

select test.assert_eq(
  public.score_to_recommendation((:'structural_score')::int),
  'avoid'::inspection_recommendation,
  'a structurally damaged car is an avoid');

-- A critical finding CAPS the score. Without this, a car sound in every other
-- respect but with confirmed accident repair scored 92% and recommended
-- `buy` — one failure among ~40 items barely moves a weighted mean, while in
-- the real market it is the finding that settles the decision.
select public.score_inspection(
  (select id from public.inspection_templates where key = 'pre_purchase_v1'),
  (select jsonb_object_agg(
     s ->> 'key',
     (select jsonb_object_agg(
        i ->> 'key',
        jsonb_build_object('rating',
          case when (i ->> 'key') = 'accident_evidence' then 'fail' else 'pass' end))
      from jsonb_array_elements(s -> 'items') as i)
   )
   from public.inspection_templates t, jsonb_array_elements(t.sections) as s
   where t.key = 'pre_purchase_v1')
) as one_accident \gset

select test.assert(
  (:'one_accident')::int <= 45,
  'a single confirmed accident caps the score regardless of everything else');

select test.assert_eq(
  public.score_to_recommendation((:'one_accident')::int),
  'avoid'::inspection_recommendation,
  'confirmed accident damage is an avoid, not a buy');

-- A critical item flagged for attention rather than outright failure caps
-- lower but not to avoid — "worth checking" is not "walk away".
select public.score_inspection(
  (select id from public.inspection_templates where key = 'pre_purchase_v1'),
  (select jsonb_object_agg(
     s ->> 'key',
     (select jsonb_object_agg(
        i ->> 'key',
        jsonb_build_object('rating',
          case when (i ->> 'key') = 'odometer_consistency' then 'attention' else 'pass' end))
      from jsonb_array_elements(s -> 'items') as i)
   )
   from public.inspection_templates t, jsonb_array_elements(t.sections) as s
   where t.key = 'pre_purchase_v1')
) as odo_doubt \gset

select test.assert_eq(
  public.score_to_recommendation((:'odo_doubt')::int),
  'negotiate'::inspection_recommendation,
  'doubt over the odometer caps at negotiate, not buy');

-- `na` is excluded rather than scored zero: a car without a sunroof should not
-- be marked down for the sunroof it does not have.
select test.assert_eq(
  public.score_inspection(
    (select id from public.inspection_templates where key = 'pre_purchase_v1'),
    '{"engine":{"oil_leaks":{"rating":"pass"},"cold_start":{"rating":"na"}}}'::jsonb),
  100, 'items rated na are excluded from the average, not counted as failures');


-- The shareable report -------------------------------------------------------------
select public_token as token from public.inspection_reports where id = :'report_id' \gset

select test.assert(length(:'token') > 30, 'the share token is unguessable');

select test.assert_eq(
  (public.get_inspection_report(:'token') ->> 'overall_score')::int,
  100, 'the report is readable by token');

select test.assert(
  public.get_inspection_report('not-a-real-token') is null,
  'an unknown token reveals nothing');

-- Privacy: the report is about the CAR (build prompt §7.3).
select test.assert(
  public.get_inspection_report(:'token')::text not like '%المشتري%',
  'the buyer''s name never appears in the shared report');
select test.assert(
  public.get_inspection_report(:'token')::text not like '%+9665%',
  'no phone number appears in the shared report');


-- Conversion: the buyer purchases -----------------------------------------------------
update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-b000-000000000001';

select test.become('11111111-0000-4000-b000-000000000001');
update public.orders set status = 'completed'
where id = 'f0000000-0000-4000-b000-000000000001';

-- Only the person who paid for the inspection may claim the car. Otherwise
-- anyone holding the public link could.
select test.become('33333333-0000-4000-b000-000000000003');
select test.assert_raises(
  format($$select public.convert_inspection_to_vehicle(
    '%s', 'a0000000-0000-4000-b000-000000000001',
    'b0000000-0000-4000-b000-000000000001')$$, :'report_id'),
  'a stranger cannot convert someone else''s inspection into their own vehicle',
  '42501');

select test.become('11111111-0000-4000-b000-000000000001');
select public.convert_inspection_to_vehicle(
  :'report_id',
  'a0000000-0000-4000-b000-000000000001',
  'b0000000-0000-4000-b000-000000000001',
  'سيارتي الجديدة'
) as vehicle_id \gset

select test.assert_eq(
  (select owner_id from public.vehicles where id = :'vehicle_id'),
  '11111111-0000-4000-b000-000000000001'::uuid,
  'the buyer now owns the vehicle');

select test.assert_eq(
  (select vin from public.vehicles where id = :'vehicle_id'),
  '1HGBH41JXMN109186',
  'the vehicle carries the VIN the inspector recorded');

select test.assert_eq(
  (select current_mileage from public.vehicles where id = :'vehicle_id'),
  120000, 'the odometer starts from the inspection reading');

select test.assert_eq(
  (select year from public.vehicles where id = :'vehicle_id'),
  2018, 'the model year comes from the inspection');


-- THE acceptance criterion: the inspection is the first thing in the logbook ------
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline where vehicle_id = :'vehicle_id'),
  2, 'the new logbook opens with registration plus the inspection');

select test.assert_eq(
  (select event_type from public.vehicle_timeline
   where vehicle_id = :'vehicle_id' and event_type = 'inspection_completed'),
  'inspection_completed'::public.timeline_event_type,
  'the inspection is in the new owner''s logbook');

-- And it is genuinely verified — Habba dispatched the inspector.
select test.assert_eq(
  (select provenance from public.vehicle_timeline
   where vehicle_id = :'vehicle_id' and event_type = 'inspection_completed'),
  'habba_verified'::public.timeline_provenance,
  'the inspection entry is habba_verified, not owner-reported');

select test.assert_eq(
  (select (details ->> 'inspection_score')::int from public.vehicle_timeline
   where vehicle_id = :'vehicle_id' and event_type = 'inspection_completed'),
  100, 'the score travels into the logbook');

select test.assert(
  (select is_valid from public.verify_vehicle_timeline(:'vehicle_id')),
  'the new logbook verifies from its first entry');

-- The report is now attached to the car.
select test.assert_eq(
  (select vehicle_id from public.inspection_reports where id = :'report_id'),
  (:'vehicle_id')::uuid,
  'the report is linked to the vehicle it produced');


-- Converting twice is refused ------------------------------------------------------
select test.assert_raises(
  format($$select public.convert_inspection_to_vehicle(
    '%s', 'a0000000-0000-4000-b000-000000000001',
    'b0000000-0000-4000-b000-000000000001')$$, :'report_id'),
  'the same inspection cannot create two vehicles',
  '23505');


-- A car already in Habba is transferred, not duplicated ------------------------------
-- Creating a second record for the same VIN would fork that car's history,
-- which is the one thing the product exists to prevent.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   service_location, provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-b000-000000000002',
   '33333333-0000-4000-b000-000000000003', null, :'svc', 'mobile_scheduled', 'draft',
   extensions.st_point(39.1930, 21.4860)::extensions.geography,
   'e0000000-0000-4000-b000-000000000001', 350, '33333333-0000-4000-b000-000000000003');

select test.become('22222222-0000-4000-b000-000000000002');
select public.submit_inspection_report(
  'f0000000-0000-4000-b000-000000000002', 'pre_purchase_v1',
  (select jsonb_object_agg(
     s ->> 'key',
     (select jsonb_object_agg(i ->> 'key', jsonb_build_object('rating', 'pass'))
      from jsonb_array_elements(s -> 'items') as i)
   )
   from public.inspection_templates t, jsonb_array_elements(t.sections) as s
   where t.key = 'pre_purchase_v1'),
  '1HGBH41JXMN109186', 'ABJ 3333', 'تويوتا', 'كامري', 2018, 120000
) as report2 \gset

select test.become('33333333-0000-4000-b000-000000000003');
select test.assert_raises(
  format($$select public.convert_inspection_to_vehicle(
    '%s', 'a0000000-0000-4000-b000-000000000001',
    'b0000000-0000-4000-b000-000000000001')$$, :'report2'),
  'a car already in a Habba logbook cannot be duplicated by a second buyer',
  '23505');

rollback;

\echo '   inspections OK'
