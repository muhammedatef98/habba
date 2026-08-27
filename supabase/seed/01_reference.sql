-- Development seed data.
-- Launch scope is Eastern Province + Riyadh (CLAUDE.md §0); other cities are
-- seeded inactive so the catalogue is ready without implying coverage.

-- Cities ---------------------------------------------------------------------
insert into public.cities (name_ar, name_en, region_ar, region_en, centroid, is_active) values
  ('الرياض',   'Riyadh',   'منطقة الرياض',   'Riyadh Region',    extensions.st_point(46.6753, 24.7136)::extensions.geography, true),
  ('الدمام',   'Dammam',   'المنطقة الشرقية', 'Eastern Province', extensions.st_point(50.1033, 26.4207)::extensions.geography, true),
  ('الخبر',    'Khobar',   'المنطقة الشرقية', 'Eastern Province', extensions.st_point(50.2083, 26.2794)::extensions.geography, true),
  ('الظهران',  'Dhahran',  'المنطقة الشرقية', 'Eastern Province', extensions.st_point(50.1140, 26.2361)::extensions.geography, true),
  ('الجبيل',   'Jubail',   'المنطقة الشرقية', 'Eastern Province', extensions.st_point(49.6225, 27.0174)::extensions.geography, true),
  ('القطيف',   'Qatif',    'المنطقة الشرقية', 'Eastern Province', extensions.st_point(50.0115, 26.5196)::extensions.geography, true),
  ('الأحساء',  'Al Ahsa',  'المنطقة الشرقية', 'Eastern Province', extensions.st_point(49.5877, 25.3833)::extensions.geography, true),
  ('جدة',      'Jeddah',   'منطقة مكة المكرمة', 'Makkah Region',  extensions.st_point(39.1925, 21.4858)::extensions.geography, false),
  ('مكة المكرمة','Makkah', 'منطقة مكة المكرمة', 'Makkah Region',  extensions.st_point(39.8579, 21.3891)::extensions.geography, false),
  ('المدينة المنورة','Madinah','منطقة المدينة المنورة','Madinah Region', extensions.st_point(39.6142, 24.5247)::extensions.geography, false)
on conflict do nothing;


-- Makes ----------------------------------------------------------------------
-- Ordered by real Saudi market share so the first screen of the picker covers
-- the large majority of users without scrolling.
insert into public.vehicle_makes (name_ar, name_en, sort_order) values
  ('تويوتا',     'Toyota',        10),
  ('هيونداي',    'Hyundai',       20),
  ('نيسان',      'Nissan',        30),
  ('كيا',        'Kia',           40),
  ('شيفروليه',   'Chevrolet',     50),
  ('فورد',       'Ford',          60),
  ('جي إم سي',   'GMC',           70),
  ('لكزس',       'Lexus',         80),
  ('هوندا',      'Honda',         90),
  ('مازda',      'Mazda',        100),
  ('ميتسوبيشي',  'Mitsubishi',   110),
  ('إم جي',      'MG',           120),
  ('شانجان',     'Changan',      130),
  ('جيلي',       'Geely',        140),
  ('مرسيدس-بنز', 'Mercedes-Benz',150),
  ('بي إم دبليو','BMW',          160),
  ('لاند روفر',  'Land Rover',   170),
  ('إيسوزو',     'Isuzu',        180)
on conflict do nothing;

-- Correct a typo in the Arabic name above without depending on statement order.
update public.vehicle_makes set name_ar = 'مازدا' where name_en = 'Mazda';


-- Models ---------------------------------------------------------------------
insert into public.vehicle_models (make_id, name_ar, name_en, year_from, body_type)
select m.id, v.name_ar, v.name_en, v.year_from, v.body_type
from public.vehicle_makes m
join (values
  ('Toyota', 'كامري',        'Camry',        2010, 'sedan'),
  ('Toyota', 'كورولا',       'Corolla',      2010, 'sedan'),
  ('Toyota', 'يارس',         'Yaris',        2010, 'sedan'),
  ('Toyota', 'هايلكس',       'Hilux',        2010, 'pickup'),
  ('Toyota', 'لاند كروزر',   'Land Cruiser', 2010, 'suv'),
  ('Toyota', 'برادو',        'Prado',        2010, 'suv'),
  ('Toyota', 'فورتشنر',      'Fortuner',     2015, 'suv'),
  ('Toyota', 'راف٤',         'RAV4',         2013, 'suv'),
  ('Toyota', 'أفالون',       'Avalon',       2013, 'sedan'),
  ('Toyota', 'إنوفا',        'Innova',       2016, 'van'),
  ('Hyundai','النترا',       'Elantra',      2011, 'sedan'),
  ('Hyundai','سوناتا',       'Sonata',       2011, 'sedan'),
  ('Hyundai','أكسنت',        'Accent',       2011, 'sedan'),
  ('Hyundai','توسان',        'Tucson',       2011, 'suv'),
  ('Hyundai','سنتافي',       'Santa Fe',     2013, 'suv'),
  ('Hyundai','كريتا',        'Creta',        2016, 'suv'),
  ('Hyundai','H1',           'H1',           2010, 'van'),
  ('Nissan', 'صني',          'Sunny',        2012, 'sedan'),
  ('Nissan', 'ألتيما',       'Altima',       2012, 'sedan'),
  ('Nissan', 'باترول',       'Patrol',       2010, 'suv'),
  ('Nissan', 'إكس تريل',     'X-Trail',      2014, 'suv'),
  ('Nissan', 'نافارا',       'Navara',       2015, 'pickup'),
  ('Nissan', 'ماكسيما',      'Maxima',       2012, 'sedan'),
  ('Kia',    'سيراتو',       'Cerato',       2012, 'sedan'),
  ('Kia',    'ريو',          'Rio',          2012, 'sedan'),
  ('Kia',    'سبورتاج',      'Sportage',     2012, 'suv'),
  ('Kia',    'سورينتو',      'Sorento',      2013, 'suv'),
  ('Kia',    'أوبتيما',      'Optima',       2012, 'sedan'),
  ('Chevrolet','ماليبو',     'Malibu',       2013, 'sedan'),
  ('Chevrolet','تاهو',       'Tahoe',        2010, 'suv'),
  ('Chevrolet','سيلفرادو',   'Silverado',    2010, 'pickup'),
  ('Chevrolet','كابتيفا',    'Captiva',      2012, 'suv'),
  ('Ford',   'تورس',         'Taurus',       2013, 'sedan'),
  ('Ford',   'إكسبلورر',     'Explorer',     2013, 'suv'),
  ('Ford',   'F-150',        'F-150',        2012, 'pickup'),
  ('Ford',   'إيدج',         'Edge',         2015, 'suv'),
  ('GMC',    'يوكن',         'Yukon',        2010, 'suv'),
  ('GMC',    'سييرا',        'Sierra',       2012, 'pickup'),
  ('GMC',    'أكاديا',       'Acadia',       2013, 'suv'),
  ('Lexus',  'ES',           'ES',           2012, 'sedan'),
  ('Lexus',  'LX',           'LX',           2010, 'suv'),
  ('Lexus',  'GX',           'GX',           2010, 'suv'),
  ('Honda',  'أكورد',        'Accord',       2012, 'sedan'),
  ('Honda',  'سيفيك',        'Civic',        2012, 'sedan'),
  ('Honda',  'CR-V',         'CR-V',         2012, 'suv'),
  ('Mazda',  'مازدا ٣',      'Mazda 3',      2012, 'sedan'),
  ('Mazda',  'مازدا ٦',      'Mazda 6',      2013, 'sedan'),
  ('Mazda',  'CX-5',         'CX-5',         2013, 'suv'),
  ('Mitsubishi','لانسر',     'Lancer',       2010, 'sedan'),
  ('Mitsubishi','باجيرو',    'Pajero',       2010, 'suv'),
  ('Mitsubishi','أتراج',     'Attrage',      2014, 'sedan'),
  ('MG',     'MG5',          'MG5',          2020, 'sedan'),
  ('MG',     'RX5',          'RX5',          2018, 'suv'),
  ('MG',     'ZS',           'ZS',           2019, 'suv'),
  ('Changan','CS35',         'CS35',         2016, 'suv'),
  ('Changan','إيدو',         'Eado',         2016, 'sedan'),
  ('Geely',  'إمجراند',      'Emgrand',      2016, 'sedan'),
  ('Geely',  'كولراي',       'Coolray',      2020, 'suv'),
  ('Mercedes-Benz','الفئة E','E-Class',      2012, 'sedan'),
  ('Mercedes-Benz','الفئة C','C-Class',      2012, 'sedan'),
  ('Mercedes-Benz','GLE',    'GLE',          2015, 'suv'),
  ('BMW',    'الفئة الخامسة','5 Series',     2012, 'sedan'),
  ('BMW',    'X5',           'X5',           2012, 'suv'),
  ('Land Rover','رينج روفر', 'Range Rover',  2012, 'suv'),
  ('Isuzu',  'دي ماكس',      'D-Max',        2012, 'pickup')
) as v(make_en, name_ar, name_en, year_from, body_type)
  on v.make_en = m.name_en
on conflict do nothing;
