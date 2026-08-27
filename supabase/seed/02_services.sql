-- Service catalogue seed — build prompt §6.3.
--
-- Emergency services are price_is_fixed with a central base_price: §11 forbids
-- providers setting their own roadside prices, and provider_services enforces
-- that. Everything variable enough to need a quote has a null base_price.
--
-- Towing is the honest exception: its real cost is distance-dependent, so it
-- is priced as a call-out base with distance handled by the pricing rules that
-- ADR-0008's pricing decision will settle. Flagged rather than papered over.

insert into public.services
  (category, name_ar, name_en, icon, supported_modes, base_price, price_is_fixed,
   est_duration_min, requires_lift, sort_order)
values
  -- طوارئ — fixed, central, no provider discretion
  ('emergency', 'ونش/سحب', 'Towing', 'truck',
   array['mobile_ondemand']::fulfilment_mode[], 150.00, true, 45, false, 10),
  ('emergency', 'بطارية — شحن أو تبديل', 'Battery jump or replacement', 'battery',
   array['mobile_ondemand']::fulfilment_mode[], 120.00, true, 30, false, 20),
  ('emergency', 'بنشر وتبديل إطار', 'Tyre puncture or change', 'tyre',
   array['mobile_ondemand']::fulfilment_mode[], 100.00, true, 30, false, 30),
  ('emergency', 'فتح أبواب', 'Lockout assistance', 'key',
   array['mobile_ondemand']::fulfilment_mode[], 130.00, true, 25, false, 40),
  ('emergency', 'توصيل بنزين', 'Fuel delivery', 'fuel',
   array['mobile_ondemand']::fulfilment_mode[], 90.00, true, 30, false, 50),
  ('emergency', 'سخونة رادياتير', 'Overheating radiator', 'thermometer',
   array['mobile_ondemand']::fulfilment_mode[], 140.00, true, 40, false, 60),

  -- صيانة دورية
  ('periodic', 'تغيير زيت وفلتر', 'Oil and filter change', 'oil',
   array['mobile_scheduled','workshop']::fulfilment_mode[], 180.00, false, 45, false, 110),
  ('periodic', 'فلتر هواء', 'Air filter', 'filter',
   array['mobile_scheduled','workshop']::fulfilment_mode[], 80.00, false, 20, false, 120),
  ('periodic', 'فحص فرامل', 'Brake inspection', 'brake',
   array['workshop']::fulfilment_mode[], null, false, 45, true, 130),
  ('periodic', 'تبديل بطارية', 'Battery replacement', 'battery',
   array['mobile_scheduled','workshop']::fulfilment_mode[], null, false, 30, false, 140),
  ('periodic', 'تبديل إطارات', 'Tyre replacement', 'tyre',
   array['workshop']::fulfilment_mode[], null, false, 60, true, 150),
  ('periodic', 'فحص تكييف', 'A/C service', 'snowflake',
   array['mobile_scheduled','workshop']::fulfilment_mode[], null, false, 60, false, 160),

  -- فحص
  ('inspection', 'فحص قبل الشراء (شامل)', 'Pre-purchase inspection', 'search',
   array['mobile_scheduled','workshop']::fulfilment_mode[], 350.00, true, 90, false, 210),
  ('inspection', 'فحص دوري', 'Periodic inspection', 'clipboard',
   array['workshop']::fulfilment_mode[], 200.00, true, 60, true, 220),
  ('inspection', 'فحص كمبيوتر', 'Computer diagnostics', 'cpu',
   array['mobile_scheduled','workshop']::fulfilment_mode[], 150.00, true, 40, false, 230),

  -- غسيل
  ('wash', 'غسيل متنقل', 'Mobile wash', 'droplet',
   array['mobile_ondemand','mobile_scheduled']::fulfilment_mode[], 60.00, true, 45, false, 310),
  ('wash', 'تلميع', 'Polishing', 'sparkle',
   array['mobile_scheduled','workshop']::fulfilment_mode[], null, false, 120, false, 320),
  ('wash', 'تنظيف داخلي', 'Interior detailing', 'seat',
   array['mobile_scheduled','workshop']::fulfilment_mode[], null, false, 120, false, 330),
  ('wash', 'حماية سيراميك', 'Ceramic coating', 'shield',
   array['workshop']::fulfilment_mode[], null, false, 480, false, 340),

  -- سمكرة ودهان
  ('bodywork', 'سمكرة', 'Panel beating', 'hammer',
   array['workshop']::fulfilment_mode[], null, false, 480, true, 410),
  ('bodywork', 'دهان', 'Paint', 'spray',
   array['workshop']::fulfilment_mode[], null, false, 720, true, 420),
  ('bodywork', 'إصلاح خدوش', 'Scratch repair', 'brush',
   array['mobile_scheduled','workshop']::fulfilment_mode[], null, false, 120, false, 430),
  ('bodywork', 'تبديل زجاج', 'Glass replacement', 'window',
   array['mobile_scheduled','workshop']::fulfilment_mode[], null, false, 120, false, 440)
on conflict do nothing;

-- Pre-purchase inspection is the one service that runs against a car the
-- customer does not own (build prompt §6.5, Phase 5).
update public.services set requires_vehicle = false where name_en = 'Pre-purchase inspection';


-- Completion evidence exemptions (0032).
--
-- Set here rather than in the migration because migrations run before seeds.
-- Demanding a before/after photo of a fuel delivery trains technicians to
-- submit junk to get past the screen — which is worse than asking for
-- nothing, because junk evidence still looks like evidence on a resale report.
update public.services
set requires_completion_photos = false
where name_en in ('Fuel delivery', 'Lockout assistance', 'Towing');

-- A pre-purchase inspection examines a car with no logbook yet, and its
-- evidence lives in the inspection report instead.
update public.services
set requires_completion_photos = false, requires_completion_mileage = false
where name_en = 'Pre-purchase inspection';
