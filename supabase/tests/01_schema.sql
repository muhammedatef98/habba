-- 01 — Schema constraints
-- Proves the corrections in ADR-0002 and ADR-0011 actually hold.

\echo '── schema constraints'

begin;

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111', '+966501111111');

insert into public.profiles (id, full_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'محمد العتيبي', '+966501111111');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c1111111-1111-1111-1111-111111111111', 'الدمام', 'Dammam', 'المنطقة الشرقية',
   'Eastern Province', extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a1111111-1111-1111-1111-111111111111', 'ماركة اختبار', 'TestMake');

insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from, body_type) values
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
   'موديل اختبار', 'TestModel', 2015, 'sedan');


-- PostGIS is actually working -----------------------------------------------
select test.assert(
  (select extensions.st_srid(centroid) from public.cities limit 1) = 4326,
  'cities.centroid is a 4326 geography'
);


-- vehicles.year: the spec's CHECK could not exist; the trigger does ---------
insert into public.vehicles (owner_id, make_id, model_id, year, plate_en)
values ('11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
        'b1111111-1111-1111-1111-111111111111', 2020, 'ABJ 1234');

select test.assert_raises(
  $$insert into public.vehicles (owner_id, make_id, model_id, year, plate_en)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
            'b1111111-1111-1111-1111-111111111111', 1969, 'ABJ 1235')$$,
  'model year before 1970 is rejected'
);

select test.assert_raises(
  format(
    $$insert into public.vehicles (owner_id, make_id, model_id, year, plate_en)
      values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
              'b1111111-1111-1111-1111-111111111111', %s, 'ABJ 1236')$$,
    extract(year from now())::int + 3),
  'model year beyond current+2 is rejected by the trigger'
);


-- Plate normalisation --------------------------------------------------------
select test.assert_eq(
  (select plate_normalised from public.vehicles where plate_en = 'ABJ 1234'),
  'ABJ1234',
  'plate_normalised is computed server-side'
);

insert into public.vehicles (owner_id, make_id, model_id, year, plate_ar)
values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
        'b1111111-1111-1111-1111-111111111111', 2021, 'أ ب ح ١٢٣٥');

select test.assert_eq(
  (select plate_normalised from public.vehicles where plate_ar = 'أ ب ح ١٢٣٥'),
  'ABJ1235',
  'Arabic plate with Arabic-Indic digits normalises to the Latin key'
);

-- The property the logbook depends on: one car, one key, either script.
select test.assert_eq(
  public.normalise_plate('أ ب ح ١٢٣٤'),
  public.normalise_plate('A B J 1234'),
  'Arabic and Latin spellings produce the same search key'
);

select test.assert_eq(public.normalise_plate('ABJ 1'), 'ABJ1',
  'a single-digit plate is valid (the spec''s "4 digits" over-constrains)');
select test.assert_eq(public.normalise_plate('هـ ب ح 1234'), 'HBJ1234',
  'tatweel in هـ is handled');
select test.assert_eq(public.normalise_plate('ا ب ج 1234'), null,
  'ج is not a plate letter and is rejected');
select test.assert_eq(public.normalise_plate('ABQ 1234'), null,
  'Q is not a plate letter and is rejected');
select test.assert_eq(public.normalise_plate('ABJ 12345'), null,
  'more than 4 digits is rejected');

select test.assert_raises(
  $$insert into public.vehicles (owner_id, make_id, model_id, year, plate_en)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
            'b1111111-1111-1111-1111-111111111111', 2020, 'ZZZZ 99999')$$,
  'an unparseable plate fails loudly at write time'
);


-- VIN --------------------------------------------------------------------
select test.assert_raises(
  $$insert into public.vehicles (owner_id, make_id, model_id, year, vin)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
            'b1111111-1111-1111-1111-111111111111', 2020, 'IOQ00000000000000')$$,
  'VIN containing I, O or Q is rejected'
);

select test.assert_raises(
  $$insert into public.vehicles (owner_id, make_id, model_id, year)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
            'b1111111-1111-1111-1111-111111111111', 2020)$$,
  'a vehicle with neither VIN nor plate is rejected'
);


-- Phone format ---------------------------------------------------------------
select test.assert_raises(
  $$insert into auth.users (id, phone) values ('99999999-9999-9999-9999-999999999999','0501234567');
    insert into public.profiles (id, full_name, phone)
    values ('99999999-9999-9999-9999-999999999999','Bad Phone','0501234567')$$,
  'a non-E.164 phone is rejected'
);


-- VAT rates ------------------------------------------------------------------
select test.assert_eq(public.vat_rate_on(date '2019-01-01'), 0.0500::numeric,
  'VAT rate in 2019 was 5%');
select test.assert_eq(public.vat_rate_on(date '2026-01-01'), 0.1500::numeric,
  'VAT rate today is 15%');

rollback;

\echo '   schema constraints OK'
