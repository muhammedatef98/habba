-- 44 — A booking somebody can answer, and an odometer that cannot run backwards
--
-- Two gaps found together, because looking for the first turned up the second.
--
-- **The booking nobody could see.** `book_appointment` opens an order at
-- `draft` (0024). The workshop transition table has `draft → accepted`. And
-- the provider's job list filters to `accepted` and beyond — so a customer
-- claimed a slot, was shown a dispatch search on the tracking screen, and
-- appeared on no provider surface at all. Every appointment in the product's
-- history would have sat in `draft` until it was cancelled. Nothing was
-- broken: each half was correct and nothing joined them.
--
-- **The odometer nobody could check.** `vehicles` has four policies (0013) and
-- every one is `owner_id = auth.uid()`, so a provider cannot read the car they
-- are working on. Correct — and it meant the evidence screen's embedded
-- `vehicles(current_mileage)` was null on every row for every provider, making
-- its «القراءة أقل من المسجّل» warning unreachable code in a shipped screen.
--
-- ⚠️ The RULE was never missing. `append_odometer_reading` (0063) refuses a
-- reading below `odometer_head()`, and the completion path appends non-strict
-- so a technician in a basement can still finish a job — the bad reading is
-- dropped from the series rather than failing the completion. Silently. What
-- 0073 adds is the one number that lets the screen say so first.

\echo '── booking confirmation and odometer sanity'

begin;

select public.test_seed_auth_user('11111111-0000-4000-c000-000000000001', '+966505000001');
select public.test_seed_auth_user('22222222-0000-4000-c000-000000000002', '+966505000002');
select public.test_seed_auth_user('33333333-0000-4000-c000-000000000003', '+966505000003');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-c000-000000000001', 'العميل', '+966505000001'),
  ('22222222-0000-4000-c000-000000000002', 'الورشة', '+966505000002'),
  ('33333333-0000-4000-c000-000000000003', 'ورشة أخرى', '+966505000003');

select test.grant_role('22222222-0000-4000-c000-000000000002', 'workshop_admin');
select test.grant_role('33333333-0000-4000-c000-000000000003', 'workshop_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-c000-000000000001', 'الخبر', 'KhobarBk', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2794)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-c000-000000000001', 'ماركة حجز', 'TestMakeBk');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-c000-000000000001', 'a0000000-0000-4000-c000-000000000001',
   'موديل حجز', 'TestModelBk', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage)
values
  ('d0000000-0000-4000-c000-000000000001', '11111111-0000-4000-c000-000000000001',
   'a0000000-0000-4000-c000-000000000001', 'b0000000-0000-4000-c000-000000000001',
   2019, 'ABJ 8080', 120000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('e0000000-0000-4000-c000-000000000001', '22222222-0000-4000-c000-000000000002',
   'workshop', 'ورشة الخبر', '1010404040', 'approved',
   'c0000000-0000-4000-c000-000000000001'),
  ('e0000000-0000-4000-c000-000000000002', '33333333-0000-4000-c000-000000000003',
   'workshop', 'ورشة المجاورة', '1010505050', 'approved',
   'c0000000-0000-4000-c000-000000000001');

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-c000-000000000001', 'شارع الخليج، الخبر',
        extensions.st_point(50.2090, 26.2800)::extensions.geography, 2,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-c000-000000000001', :'svc_oil');

insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-c000-000000000001',
        'e0000000-0000-4000-c000-000000000001',
        now() + interval '3 days', now() + interval '3 days 1 hour', 1);


-- The booking ------------------------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');

select public.book_appointment(
  '50000000-0000-4000-c000-000000000001', :'svc_oil',
  'd0000000-0000-4000-c000-000000000001', 'صوت من المكينة', 120500) as booking \gset

select test.assert_eq(
  (select status::text from public.orders where id = :'booking'),
  'draft',
  'a booked appointment opens at draft — it is not confirmed by being made');

reset role;


-- The workshop can SEE it ---------------------------------------------------------
-- ⚠️ The assertion the whole surface rests on. `orders_read_assigned_provider`
-- (0022) admits the workshop, so the row was always readable — the provider app
-- simply never asked for this status.
set role authenticated;
select test.become('22222222-0000-4000-c000-000000000002');

select test.assert_eq(
  (select count(*)::int from public.orders
    where status = 'draft' and provider_id = 'e0000000-0000-4000-c000-000000000001'),
  1, 'the workshop can read the booking waiting on its answer');

-- And the neighbour cannot.
select test.become('33333333-0000-4000-c000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.orders where id = :'booking'),
  0, 'a different workshop sees nothing of it');

reset role;


-- accept_order is NOT the path ----------------------------------------------------
-- It claims an order with no provider (0033). A booking names its provider,
-- because the customer chose them — so the function correctly declines to help,
-- and a surface built on it would have looked broken for no visible reason.
set role authenticated;
select test.become('22222222-0000-4000-c000-000000000002');

-- It refuses before it even reaches the claim — the funding gate fires first,
-- because a booking carries a quoted amount and no escrow is authorised until
-- the payment provider exists (ADR-0008). Either way the outcome is the same
-- and the point stands: a surface built on `accept_order` would have looked
-- broken to a workshop for a reason it could never have guessed.
select test.assert_raises(
  format($$select public.accept_order('%s')$$, :'booking'),
  'accept_order is not the path a booking takes',
  '23514');

select test.assert_eq(
  (select status::text from public.orders where id = :'booking'),
  'draft', 'so the booking is still waiting');

reset role;


-- Confirming ----------------------------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-c000-000000000002');

update public.orders set status = 'accepted' where id = :'booking';

select test.assert_eq(
  (select status::text from public.orders where id = :'booking'),
  'accepted', 'the assigned workshop confirms its own booking');

-- And it now appears in the job list the provider app actually reads.
select test.assert_eq(
  (select count(*)::int from public.orders
    where id = :'booking'
      and status in ('accepted','en_route','arrived','checked_in','in_progress','awaiting_approval')),
  1, 'and from there it is a job like any other');

reset role;


-- A customer cannot confirm on the workshop's behalf ----------------------------
-- `guard_order_columns` lets a customer cancel and confirm completion, both
-- through the state machine. Accepting is the workshop's word, not theirs.
-- Second slot, published as the migration role: a workshop publishing its own
-- calendar is suite 43's subject, not this one's.
insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-c000-000000000002',
        'e0000000-0000-4000-c000-000000000001',
        now() + interval '4 days', now() + interval '4 days 1 hour', 1);

set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');

select public.book_appointment(
  '50000000-0000-4000-c000-000000000002', :'svc_oil',
  'd0000000-0000-4000-c000-000000000001', 'فحص دوري', 120600) as booking2 \gset

-- ⚠️ The hole 0074 closes. Before it, this succeeded: `orders_update_customer`
-- plus `('workshop','draft','accepted')` allowed it and nothing asked who was
-- writing — so a workshop could find a committed job on its list, with a bay
-- reserved and a price fixed, that it had never agreed to.
select test.assert_raises(
  format($$update public.orders set status = 'accepted' where id = '%s'$$, :'booking2'),
  'a customer cannot accept a booking on the workshop''s behalf',
  '42501');

select test.assert_eq(
  (select status::text from public.orders where id = :'booking2'),
  'draft', 'the booking is still the workshop''s to answer');

-- But cancelling is still theirs. Their money, their car.
update public.orders set status = 'cancelled' where id = :'booking2';
select test.assert_eq(
  (select status::text from public.orders where id = :'booking2'),
  'cancelled', 'and the customer can still walk away from it');

reset role;


-- Declining releases the slot -------------------------------------------------------
insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-c000-000000000003',
        'e0000000-0000-4000-c000-000000000001',
        now() + interval '5 days', now() + interval '5 days 1 hour', 1);

set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');

select public.book_appointment(
  '50000000-0000-4000-c000-000000000003', :'svc_oil',
  'd0000000-0000-4000-c000-000000000001', 'غسيل', 120700) as booking3 \gset

select test.assert_eq(
  (select booked_count from public.appointment_slots
    where id = '50000000-0000-4000-c000-000000000003'),
  1, 'the place is taken while the booking stands');

select test.become('22222222-0000-4000-c000-000000000002');
update public.orders
   set status = 'cancelled', cancellation_reason = 'الورشة مغلقة ذلك اليوم'
 where id = :'booking3';

select test.assert_eq(
  (select booked_count from public.appointment_slots
    where id = '50000000-0000-4000-c000-000000000003'),
  0, 'declining hands the place back to the calendar (release_slot_on_cancel)');

reset role;


-- ===================================================================================
-- The odometer
-- ===================================================================================
-- Drive the first booking to a status where evidence is recorded.
set role authenticated;
select test.become('22222222-0000-4000-c000-000000000002');
update public.orders set status = 'checked_in' where id = :'booking';
update public.orders set status = 'in_progress' where id = :'booking';
reset role;


-- The provider still cannot read the car ---------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-c000-000000000002');

select test.assert_eq(
  (select count(*)::int from public.vehicles
    where id = 'd0000000-0000-4000-c000-000000000001'),
  0, 'a provider cannot read the vehicle row — the embedded join returns nothing');

-- ...but can ask for the one number they need to do the job.
select test.assert_eq(
  public.last_known_mileage_for_order(:'booking'),
  120000,
  'and can read the last odometer on file for the job in their hand');

reset role;


-- And nobody else can ------------------------------------------------------------------
set role authenticated;
select test.become('33333333-0000-4000-c000-000000000003');

select test.assert(
  public.last_known_mileage_for_order(:'booking') is null,
  'a workshop with no claim on the order learns nothing about the car');

reset role;

-- The owner may ask about their own car's job.
set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');
select test.assert_eq(
  public.last_known_mileage_for_order(:'booking'),
  120000,
  'and the owner may ask about their own');
reset role;


-- The number the warning compares against is the series', not the vehicle's ----------
-- ⚠️ This is why the function returns `odometer_head().km` rather than
-- `vehicles.current_mileage`: the head is what `append_odometer_reading`
-- checks, and a screen warning from a different number would fire at the wrong
-- moments in both directions.
set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');
select public.record_mileage('d0000000-0000-4000-c000-000000000001', 121400);
reset role;

set role authenticated;
select test.become('22222222-0000-4000-c000-000000000002');

select test.assert_eq(
  public.last_known_mileage_for_order(:'booking'),
  121400,
  'a newer reading moves what the technician is shown');

-- And recording evidence still works, unchanged by 0073.
select public.record_completion_evidence(:'booking', 121540, '[]'::jsonb);
select test.assert_eq(
  (select completion_mileage from public.orders where id = :'booking'),
  121540, 'a plausible reading is recorded');

reset role;


-- Still only the assigned provider ---------------------------------------------------
set role authenticated;
select test.become('33333333-0000-4000-c000-000000000003');

select test.assert_raises(
  format($$select public.record_completion_evidence('%s', 121600, '[]'::jsonb)$$, :'booking'),
  '0073 did not loosen who may record evidence',
  '42501');

reset role;

rollback;
