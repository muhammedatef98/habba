-- 10 — Predictive maintenance, ZATCA invoicing and payouts
--
-- Phase 6 acceptance: "a vehicle with history receives a correctly-timed
-- alert; a completed order produces a ZATCA-valid invoice with a scannable QR."

\echo '── intelligence and compliance'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-c000-000000000001', '+966505000001'),
  ('22222222-0000-4000-c000-000000000002', '+966505000002'),
  ('33333333-0000-4000-c000-000000000003', '+966505000003');

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-c000-000000000001', 'المالك',  '+966505000001', 'customer'),
  ('22222222-0000-4000-c000-000000000002', 'الورشة',  '+966505000002', 'workshop_admin'),
  ('33333333-0000-4000-c000-000000000003', 'المشغّل', '+966505000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-c000-000000000001', 'الرياض', 'RiyadhIntel', 'الرياض', 'Riyadh',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-c000-000000000001', 'ماركة ذكاء', 'TestMakeIntel');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-c000-000000000001', 'a0000000-0000-4000-c000-000000000001',
   'موديل ذكاء', 'TestModelIntel', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-c000-000000000001', '11111111-0000-4000-c000-000000000001',
   'a0000000-0000-4000-c000-000000000001', 'b0000000-0000-4000-c000-000000000001',
   2020, 'ABJ 9999', 60000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('e0000000-0000-4000-c000-000000000001', '22222222-0000-4000-c000-000000000002',
   'workshop', 'ورشة الذكاء', '1010303030', 'approved',
   'c0000000-0000-4000-c000-000000000001');

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-c000-000000000001', 'عنوان',
        extensions.st_point(46.676, 24.714)::extensions.geography, 2,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-c000-000000000001', :'svc_oil');


-- ===========================================================================
-- Mileage estimation
-- ===========================================================================
select test.become('11111111-0000-4000-c000-000000000001');

-- A year of readings: 60,000 → 84,000, roughly 66 km/day.
select public.record_mileage(
  'd0000000-0000-4000-c000-000000000001', 60000, now() - interval '365 days');
select public.record_mileage(
  'd0000000-0000-4000-c000-000000000001', 72000, now() - interval '180 days');
select public.record_mileage(
  'd0000000-0000-4000-c000-000000000001', 84000, now() - interval '30 days');

select public.estimate_current_mileage('d0000000-0000-4000-c000-000000000001') as est \gset

-- 84,000 plus ~30 days at ~72 km/day.
select test.assert(
  (:'est')::int between 85500 and 87500,
  'mileage is extrapolated from the daily rate across the whole history');

-- The rate must come from first-to-last, not the last two readings: two
-- readings a day apart give a wild rate that then extrapolates for months.
select test.assert(
  (:'est')::int < 95000,
  'the estimate does not run away from a short recent interval');


-- Readings arrive out of order, and the estimator must survive it -----------------
-- A technician records 62,000 from a service docket today for a car that read
-- 84,000 last month. Anchoring on the chronologically LAST reading collapsed
-- the estimate to 62,000 and the car silently stopped being alerted about
-- anything. Odometers do not go backwards; readings do.
-- Note the route: record_mileage REJECTS a lower current reading, so this
-- cannot arrive that way. It arrives as a service completion, where the
-- odometer comes from mileage_at_order and no such guard applies.
select public.append_vehicle_timeline_event(
  p_vehicle_id  => 'd0000000-0000-4000-c000-000000000001',
  p_event_type  => 'service_completed',
  p_summary_ar  => 'صيانة بقراءة عداد أقدم',
  p_summary_en  => 'Service recorded with an older odometer reading',
  p_occurred_at => now(),
  p_mileage     => 62000);

select public.estimate_current_mileage('d0000000-0000-4000-c000-000000000001') as est_after \gset

select test.assert(
  (:'est_after')::int > 84000,
  'a later but LOWER reading does not drag the estimate below the odometer');


-- ===========================================================================
-- Alerts
-- ===========================================================================
-- A completed oil change at 62,000 km, a year ago.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   workshop_id, provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-c000-000000000001',
   '11111111-0000-4000-c000-000000000001', 'd0000000-0000-4000-c000-000000000001',
   :'svc_oil', 'workshop', 'draft',
   'e0000000-0000-4000-c000-000000000001', 'e0000000-0000-4000-c000-000000000001',
   180, '11111111-0000-4000-c000-000000000001');

update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-c000-000000000001';
update public.orders set status = 'accepted', escrow_status = 'authorised',
  payment_intent_id = 'intel_1' where id = 'f0000000-0000-4000-c000-000000000001';
update public.orders set status = 'checked_in' where id = 'f0000000-0000-4000-c000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-c000-000000000001';
update public.orders
set completion_mileage = 62000, completion_media = '[{"url":"https://example.test/b.jpg","kind":"before"},{"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb
where id = 'f0000000-0000-4000-c000-000000000001';
update public.orders set status = 'awaiting_approval',
  labour_amount = 180, vat_amount = 27, total_amount = 207, vat_rate_applied = 0.15,
  mileage_at_order = 62000
where id = 'f0000000-0000-4000-c000-000000000001';
update public.orders set status = 'completed', completed_at = now() - interval '360 days'
where id = 'f0000000-0000-4000-c000-000000000001';

-- The generic oil rule is 7,000 km. Last done at 62,000, so due at 69,000 —
-- and the car is estimated past 85,000. Overdue.
select public.scan_vehicle_maintenance('d0000000-0000-4000-c000-000000000001') as created \gset

select test.assert_eq((:'created')::int, 1, 'the scan raises an alert for the overdue service');

select test.assert(
  (select message_ar from public.maintenance_alerts
   where vehicle_id = 'd0000000-0000-4000-c000-000000000001') like '%تجاوزت الموعد%',
  'the alert says the service is overdue, with the distance');

-- A generic interval must not present itself as manufacturer guidance.
select test.assert(
  (select message_ar from public.maintenance_alerts
   where vehicle_id = 'd0000000-0000-4000-c000-000000000001') like '%تقدير عام%',
  'a generic-confidence rule is labelled as an estimate in the message');

select test.assert_eq(
  (select confidence from public.maintenance_alerts
   where vehicle_id = 'd0000000-0000-4000-c000-000000000001'),
  'generic'::maintenance_confidence,
  'the alert records the confidence it was based on');

-- §1: the timeline records every warning the system raised.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd0000000-0000-4000-c000-000000000001'
     and event_type = 'alert_raised'),
  1, 'the alert is recorded in the logbook');


-- The product rule: never more than one alert per vehicle per week -------------
select test.assert_eq(
  public.scan_vehicle_maintenance('d0000000-0000-4000-c000-000000000001'),
  0, 'a second scan the same day raises nothing — alert fatigue kills the feature');

-- And the open alert is not duplicated even after the week passes.
update public.maintenance_alerts set created_at = now() - interval '30 days'
where vehicle_id = 'd0000000-0000-4000-c000-000000000001';

select test.assert_eq(
  public.scan_vehicle_maintenance('d0000000-0000-4000-c000-000000000001'),
  0, 'an already-open alert for the same rule is not raised again');


-- Dismissal is part of the car's history ---------------------------------------
select id as alert_id from public.maintenance_alerts
where vehicle_id = 'd0000000-0000-4000-c000-000000000001' limit 1 \gset

select public.dismiss_alert(:'alert_id');

select test.assert_eq(
  (select status from public.maintenance_alerts where id = :'alert_id'),
  'dismissed'::alert_status, 'the alert is dismissed');

-- A buyer reading a resale report is entitled to know a service was flagged
-- and declined.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd0000000-0000-4000-c000-000000000001'
     and event_type = 'alert_dismissed'),
  1, 'declining a warning is recorded in the logbook too');


-- A car with no history is not alerted about services it may not need -----------
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage)
values ('d0000000-0000-4000-c000-000000000002', '11111111-0000-4000-c000-000000000001',
        'a0000000-0000-4000-c000-000000000001', 'b0000000-0000-4000-c000-000000000001',
        2023, 'ABJ 1010', 5000);

select test.assert_eq(
  public.scan_vehicle_maintenance('d0000000-0000-4000-c000-000000000002'),
  0, 'a newly added car with no service history is not immediately alerted');


-- ===========================================================================
-- ZATCA
-- ===========================================================================
-- The TLV encoding, checked byte by byte against a hand-computed expectation.
-- Tag 1, length 3, "ABC" → 0x01 0x03 'A' 'B' 'C'.
select test.assert_eq(
  encode(public.zatca_tlv(1, 'ABC'), 'hex'),
  '0103414243',
  'TLV encodes tag, length and value in that order');

-- Arabic is multi-byte: the length is in BYTES, not characters. Getting this
-- wrong produces a QR that scans as garbage for every Saudi seller.
select test.assert_eq(
  encode(public.zatca_tlv(1, 'هبّة'), 'hex'),
  '0108' || encode(convert_to('هبّة', 'UTF8'), 'hex'),
  'TLV length counts UTF-8 bytes, not characters');

select test.assert_eq(
  length(convert_to('هبّة', 'UTF8')),
  8, 'the Arabic test value really is 8 bytes for 4 characters');

-- A single length byte caps a value at 127 bytes, which a long Arabic legal
-- name can exceed. Silently truncating a seller name on a tax document is not
-- an option, so it raises.
select test.assert_raises(
  $$select public.zatca_tlv(1, repeat('م', 100))$$,
  'a value over 127 bytes is rejected rather than truncated',
  '23514');

-- The full payload decodes back to its five tags.
select public.zatca_qr(
  'شركة هبّة للتقنية', '300000000000003',
  timestamptz '2026-08-27 09:30:00+00', 207.00, 27.00) as qr \gset

select test.assert(length(:'qr') > 40, 'the QR payload is produced');

select test.assert_eq(
  get_byte(decode(:'qr', 'base64'), 0), 1,
  'the payload starts with tag 1 (seller name)');

-- The amounts must be plain decimals — not currency formatted, not thousands
-- separated — or ZATCA validators reject them.
select test.assert(
  position(convert_to('207.00', 'UTF8') in decode(:'qr', 'base64')) > 0,
  'the total appears as a plain two-decimal string');
select test.assert(
  position(convert_to('27.00', 'UTF8') in decode(:'qr', 'base64')) > 0,
  'the VAT amount appears as a plain two-decimal string');

-- The timestamp must be UTC with a Z designator; a local time or an offset is
-- rejected by validators.
select test.assert(
  position(convert_to('2026-08-27T09:30:00Z', 'UTF8') in decode(:'qr', 'base64')) > 0,
  'the timestamp is ISO 8601 UTC with a Z designator');


-- Issuing an invoice ------------------------------------------------------------
select public.issue_zatca_invoice('f0000000-0000-4000-c000-000000000001') as invoice_id \gset

select test.assert(
  (select invoice_number from public.zatca_invoices where id = :'invoice_id') like 'HB-INV-%',
  'the invoice is numbered');

select test.assert_eq(
  (select total_amount from public.zatca_invoices where id = :'invoice_id'),
  207.00::numeric, 'the invoice total matches the order');

select test.assert_eq(
  (select net_amount + vat_amount from public.zatca_invoices where id = :'invoice_id'),
  207.00::numeric, 'net plus VAT reconciles to the total');

select test.assert(
  (select qr_base64 from public.zatca_invoices where id = :'invoice_id') is not null,
  'the invoice carries a QR');

-- The seller is recorded, so invoices stay attributable whichever way
-- ADR-0009 lands.
select test.assert(
  (select seller_id from public.zatca_invoices where id = :'invoice_id') is not null,
  'the invoice records which seller issued it');

select test.assert_raises(
  $$select public.issue_zatca_invoice('f0000000-0000-4000-c000-000000000001')$$,
  'an order cannot be invoiced twice',
  '23505');


-- ===========================================================================
-- Payouts
-- ===========================================================================
update public.orders set escrow_status = 'captured'
where id = 'f0000000-0000-4000-c000-000000000001';

select test.become('33333333-0000-4000-c000-000000000003');   -- ops

select public.build_payout(
  'e0000000-0000-4000-c000-000000000001',
  (now() - interval '400 days')::date,
  now()::date
) as payout_id \gset

select test.assert_eq(
  (select order_count from public.payouts where id = :'payout_id'),
  1, 'the completed captured order is in the payout');

select test.assert_eq(
  (select gross_amount from public.payouts where id = :'payout_id'),
  207.00::numeric, 'gross is the full amount the customer paid');

-- Commission is taken on the net, never on the VAT: a cut of the tax would be
-- a cut of money that belongs to ZATCA.
select test.assert_eq(
  (select commission from public.payouts where id = :'payout_id'),
  36.00::numeric, 'commission is 20% of the 180 net, not of the 207 gross');

select test.assert_eq(
  (select net_amount from public.payouts where id = :'payout_id'),
  171.00::numeric, 'the provider receives gross minus commission');

-- An order already paid out is never included again.
select public.build_payout(
  'e0000000-0000-4000-c000-000000000001',
  (now() - interval '400 days')::date,
  (now() - interval '1 day')::date
) as payout2 \gset

select test.assert_eq(
  (select order_count from public.payouts where id = :'payout2'),
  0, 'an order already in a payout is not paid twice');

-- Uncaptured money is not paid out: settling on an order whose capture failed
-- means paying the provider from Habba's own pocket.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   workshop_id, provider_id, quoted_amount, created_by, escrow_status,
   labour_amount, vat_amount, total_amount, completed_at)
values
  ('f0000000-0000-4000-c000-000000000002',
   '11111111-0000-4000-c000-000000000001', 'd0000000-0000-4000-c000-000000000001',
   :'svc_oil', 'workshop', 'draft',
   'e0000000-0000-4000-c000-000000000001', 'e0000000-0000-4000-c000-000000000001',
   180, '11111111-0000-4000-c000-000000000001', 'authorised',
   180, 27, 207, now());

update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-c000-000000000002';
update public.orders set status = 'accepted', payment_intent_id = 'intel_2'
where id = 'f0000000-0000-4000-c000-000000000002';
update public.orders set status = 'checked_in' where id = 'f0000000-0000-4000-c000-000000000002';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-c000-000000000002';
update public.orders
set completion_mileage = 62500,
    completion_media = '[{"url":"https://example.test/b.jpg","kind":"before"},{"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb
where id = 'f0000000-0000-4000-c000-000000000002';
update public.orders set status = 'awaiting_approval' where id = 'f0000000-0000-4000-c000-000000000002';
select test.become('11111111-0000-4000-c000-000000000001');
update public.orders set status = 'completed' where id = 'f0000000-0000-4000-c000-000000000002';

select test.become('33333333-0000-4000-c000-000000000003');
select public.build_payout(
  'e0000000-0000-4000-c000-000000000001',
  (now() - interval '2 days')::date,
  (now() + interval '1 day')::date
) as payout3 \gset

select test.assert_eq(
  (select order_count from public.payouts where id = :'payout3'),
  0, 'an authorised-but-uncaptured order is not paid out');

-- A provider cannot build their own payout.
select test.become('22222222-0000-4000-c000-000000000002');
select test.assert_raises(
  $$select public.build_payout('e0000000-0000-4000-c000-000000000001',
      current_date - 30, current_date)$$,
  'a provider cannot build their own payout',
  '42501');

rollback;

\echo '   intelligence and compliance OK'
