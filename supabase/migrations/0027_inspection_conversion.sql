-- 0027 — Buyer → owner conversion
--
-- CLAUDE.md §1, moat reason 3: the new owner receives a logbook, which is free
-- customer acquisition with zero CAC. The pre-purchase inspection is the
-- sharper version of that — someone who is not yet a Habba customer pays for
-- an inspection, buys the car, and their logbook opens with a Habba-verified
-- assessment of it already inside.
--
-- That first entry matters disproportionately. A logbook that starts empty
-- asks the owner for faith; a logbook that starts with a 78% inspection and
-- eleven photographed findings has already demonstrated what it is for.

create or replace function public.convert_inspection_to_vehicle(
  p_report_id uuid,
  p_make_id   uuid,
  p_model_id  uuid,
  p_nickname  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := auth.uid();
  v_report    record;
  v_order     record;
  v_vehicle_id uuid;
  v_year      int;
  v_plate     text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_report
  from public.inspection_reports r where r.id = p_report_id;

  if v_report is null then
    raise exception 'Inspection report % not found', p_report_id using errcode = 'no_data_found';
  end if;

  if v_report.completed_at is null then
    raise exception 'That inspection is not finished' using errcode = 'check_violation';
  end if;

  if v_report.vehicle_id is not null then
    raise exception 'That inspection is already attached to a vehicle'
      using errcode = 'unique_violation',
            hint = 'The car is already in a logbook.';
  end if;

  select * into v_order from public.orders o where o.id = v_report.order_id;

  -- Only the person who commissioned the inspection may convert it. Otherwise
  -- anyone holding the public share link could claim the car.
  if v_order.customer_id <> v_actor then
    raise exception 'Only the customer who ordered this inspection may add the car'
      using errcode = 'insufficient_privilege';
  end if;

  v_year := coalesce(v_report.subject_year, extract(year from now())::int);
  v_plate := v_report.subject_plate;

  -- If this VIN is already a live vehicle, the car is in someone's logbook.
  -- Silently creating a second record would fork the car's history — the one
  -- thing the whole product exists to prevent. Ownership transfer is the
  -- correct route (0011).
  if v_report.subject_vin is not null
     and exists (select 1 from public.vehicles v
                 where v.vin = v_report.subject_vin and v.is_active) then
    raise exception 'This car already has a Habba logbook'
      using errcode = 'unique_violation',
            hint = 'Ask the current owner to transfer ownership to you in the app.';
  end if;

  insert into public.vehicles (
    owner_id, make_id, model_id, year, vin, plate_en,
    current_mileage, mileage_updated_at, nickname, created_by
  ) values (
    v_actor, p_make_id, p_model_id, v_year,
    v_report.subject_vin, v_plate,
    coalesce(v_report.subject_mileage, 0),
    case when v_report.subject_mileage is not null then v_report.completed_at end,
    p_nickname, v_actor
  )
  returning id into v_vehicle_id;

  update public.inspection_reports
  set vehicle_id = v_vehicle_id
  where id = p_report_id;

  -- Attach the order to the vehicle too, so the completed inspection order and
  -- its logbook entry agree about which car they concern.
  update public.orders set vehicle_id = v_vehicle_id where id = v_report.order_id;

  -- Registration first, then the inspection — the logbook reads in the order
  -- things happened, and the car was registered in Habba at this moment.
  perform public.append_vehicle_timeline_event(
    p_vehicle_id  => v_vehicle_id,
    p_event_type  => 'vehicle_registered',
    p_summary_ar  => 'تم تسجيل السيارة في هبّة بعد فحص ما قبل الشراء',
    p_summary_en  => 'Vehicle registered with Habba following a pre-purchase inspection',
    p_occurred_at => now(),
    p_mileage     => v_report.subject_mileage
  );

  -- The inspection itself, carrying an order_id so it derives as
  -- habba_verified: Habba dispatched the inspector and holds the photos.
  perform public.append_vehicle_timeline_event(
    p_vehicle_id  => v_vehicle_id,
    p_event_type  => 'inspection_completed',
    p_summary_ar  => format('فحص ما قبل الشراء — النتيجة %s%%', v_report.overall_score),
    p_summary_en  => format('Pre-purchase inspection — score %s%%', v_report.overall_score),
    p_occurred_at => v_report.completed_at,
    p_mileage     => v_report.subject_mileage,
    p_order_id    => v_report.order_id,
    p_provider_id => v_order.provider_id,
    p_details     => jsonb_strip_nulls(jsonb_build_object(
      'inspection_score', v_report.overall_score,
      'service_kind', 'pre_purchase_inspection',
      'notes_public', v_report.recommendation::text
    )),
    p_attachments => '[]'::jsonb
  );

  return v_vehicle_id;
end;
$$;

comment on function public.convert_inspection_to_vehicle is
  'Buyer becomes owner. The new logbook opens with the Habba-verified inspection. CLAUDE.md §1.';

grant execute on function public.convert_inspection_to_vehicle(uuid, uuid, uuid, text) to authenticated;


-- Seed: the pre-purchase template ---------------------------------------------
-- Build prompt §6.7 requires at minimum المحرك، ناقل الحركة، الفرامل، التعليق،
-- الكهرباء، الإطارات، الهيكل والشاسيه، الفرش الداخلي، التكييف، فحص الكمبيوتر،
-- تاريخ الحوادث.
--
-- Section weights encode what actually costs money to fix. Chassis damage and
-- a failing gearbox are not comparable to worn interior trim, and a score that
-- treated them equally would send buyers into bad purchases with a reassuring
-- number attached.
insert into public.inspection_templates (key, name_ar, name_en, sections) values (
  'pre_purchase_v1',
  'فحص ما قبل الشراء (شامل)',
  'Pre-purchase inspection (comprehensive)',
  '[
    {"key":"engine","title_ar":"المحرك","title_en":"Engine","weight":3,"items":[
      {"key":"oil_leaks","label_ar":"تسريب زيت","label_en":"Oil leaks","type":"rating","required":true,"weight":2},
      {"key":"cold_start","label_ar":"التشغيل البارد","label_en":"Cold start","type":"rating","required":true,"weight":2},
      {"key":"idle","label_ar":"ثبات الدوران","label_en":"Idle stability","type":"rating","required":true},
      {"key":"noises","label_ar":"أصوات غير طبيعية","label_en":"Abnormal noises","type":"rating","required":true,"weight":2},
      {"key":"smoke","label_ar":"دخان العادم","label_en":"Exhaust smoke","type":"rating","required":true,"weight":2},
      {"key":"belts","label_ar":"السيور","label_en":"Belts","type":"rating","required":false}
    ]},
    {"key":"transmission","title_ar":"ناقل الحركة","title_en":"Transmission","weight":3,"items":[
      {"key":"shift_quality","label_ar":"نعومة التعشيق","label_en":"Shift quality","type":"rating","required":true,"weight":3},
      {"key":"slipping","label_ar":"انزلاق الجير","label_en":"Slipping","type":"rating","required":true,"weight":3},
      {"key":"fluid","label_ar":"زيت الجير","label_en":"Transmission fluid","type":"rating","required":true}
    ]},
    {"key":"brakes","title_ar":"الفرامل","title_en":"Brakes","weight":3,"items":[
      {"key":"pads","label_ar":"الفحمات","label_en":"Pads","type":"rating","required":true,"weight":2},
      {"key":"discs","label_ar":"الهوبات","label_en":"Discs","type":"rating","required":true,"weight":2},
      {"key":"abs","label_ar":"نظام ABS","label_en":"ABS","type":"rating","required":true,"weight":2},
      {"key":"handbrake","label_ar":"فرامل اليد","label_en":"Handbrake","type":"rating","required":false}
    ]},
    {"key":"suspension","title_ar":"التعليق","title_en":"Suspension","weight":2,"items":[
      {"key":"shocks","label_ar":"المساعدات","label_en":"Shock absorbers","type":"rating","required":true,"weight":2},
      {"key":"bushings","label_ar":"الجلود والمساند","label_en":"Bushings","type":"rating","required":true},
      {"key":"steering_play","label_ar":"خلخلة الدركسيون","label_en":"Steering play","type":"rating","required":true,"weight":2}
    ]},
    {"key":"electrical","title_ar":"الكهرباء","title_en":"Electrical","weight":2,"items":[
      {"key":"battery","label_ar":"البطارية","label_en":"Battery","type":"rating","required":true},
      {"key":"alternator","label_ar":"الدينمو","label_en":"Alternator","type":"rating","required":true,"weight":2},
      {"key":"lights","label_ar":"الإضاءة","label_en":"Lights","type":"rating","required":true},
      {"key":"windows","label_ar":"النوافذ الكهربائية","label_en":"Power windows","type":"rating","required":false}
    ]},
    {"key":"tyres","title_ar":"الإطارات","title_en":"Tyres","weight":2,"items":[
      {"key":"tread","label_ar":"عمق النقشة","label_en":"Tread depth","type":"rating","required":true,"weight":2},
      {"key":"age","label_ar":"عمر الإطارات","label_en":"Tyre age","type":"rating","required":true},
      {"key":"uneven_wear","label_ar":"تآكل غير منتظم","label_en":"Uneven wear","type":"rating","required":true,"weight":2},
      {"key":"spare","label_ar":"الإطار الاحتياطي","label_en":"Spare tyre","type":"rating","required":false}
    ]},
    {"key":"body_chassis","title_ar":"الهيكل والشاسيه","title_en":"Body and chassis","weight":4,"items":[
      {"key":"chassis_straight","label_ar":"استقامة الشاسيه","label_en":"Chassis alignment","type":"rating","required":true,"weight":4,"critical":true},
      {"key":"weld_marks","label_ar":"آثار لحام","label_en":"Weld marks","type":"rating","required":true,"weight":3},
      {"key":"paint_thickness","label_ar":"سماكة الدهان","label_en":"Paint thickness","type":"rating","required":true,"weight":2},
      {"key":"rust","label_ar":"الصدأ","label_en":"Rust","type":"rating","required":true,"weight":2},
      {"key":"panel_gaps","label_ar":"فراغات القطع","label_en":"Panel gaps","type":"rating","required":true}
    ]},
    {"key":"interior","title_ar":"الفرش الداخلي","title_en":"Interior","weight":1,"items":[
      {"key":"seats","label_ar":"المقاعد","label_en":"Seats","type":"rating","required":true},
      {"key":"dashboard","label_ar":"لوحة القيادة","label_en":"Dashboard","type":"rating","required":true},
      {"key":"odour","label_ar":"الروائح","label_en":"Odours","type":"rating","required":false}
    ]},
    {"key":"ac","title_ar":"التكييف","title_en":"Air conditioning","weight":2,"items":[
      {"key":"cooling","label_ar":"كفاءة التبريد","label_en":"Cooling performance","type":"rating","required":true,"weight":3},
      {"key":"compressor","label_ar":"الكمبروسر","label_en":"Compressor","type":"rating","required":true,"weight":2},
      {"key":"blower","label_ar":"المروحة","label_en":"Blower","type":"rating","required":false}
    ]},
    {"key":"obd","title_ar":"فحص الكمبيوتر","title_en":"Computer diagnostics","weight":3,"items":[
      {"key":"stored_codes","label_ar":"أكواد مخزّنة","label_en":"Stored fault codes","type":"rating","required":true,"weight":3},
      {"key":"airbag_system","label_ar":"نظام الوسائد الهوائية","label_en":"Airbag system","type":"rating","required":true,"weight":3},
      {"key":"readiness","label_ar":"جاهزية الأنظمة","label_en":"Readiness monitors","type":"rating","required":true}
    ]},
    {"key":"history","title_ar":"تاريخ الحوادث","title_en":"Accident history","weight":4,"items":[
      {"key":"accident_evidence","label_ar":"آثار حوادث","label_en":"Evidence of accidents","type":"rating","required":true,"weight":4,"critical":true},
      {"key":"airbag_deployed","label_ar":"انفجار وسائد سابق","label_en":"Previous airbag deployment","type":"rating","required":true,"weight":4,"critical":true},
      {"key":"flood_damage","label_ar":"آثار غرق","label_en":"Flood damage","type":"rating","required":true,"weight":4,"critical":true},
      {"key":"odometer_consistency","label_ar":"منطقية العداد","label_en":"Odometer consistency","type":"rating","required":true,"weight":3,"critical":true}
    ]}
  ]'::jsonb
) on conflict (key) do nothing;
