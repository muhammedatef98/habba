/**
 * `pre_purchase_v1`, mirrored from the seed in migration 0027.
 *
 * The dev build has no database, and a stub template of three items would let
 * the capture screen ship without anyone ever having filled the form it will
 * actually meet: forty-three items across eleven sections, four of them
 * critical. Most of what is hard about that screen — finding your place,
 * knowing what is left, scoring live — only appears at that size.
 *
 * The duplication is real, so it is checked rather than trusted:
 * `inspection.integration.test.ts` reads the seeded template out of the
 * database and asserts it equals this, key for key and weight for weight. A
 * template revised in a migration fails there rather than quietly giving
 * developers a different car to inspect than customers get.
 */

import type { InspectionTemplateSection } from '@habba/core';

export const DEV_INSPECTION_TEMPLATE_KEY = 'pre_purchase_v1';
export const DEV_INSPECTION_TEMPLATE_NAME_AR = 'فحص ما قبل الشراء (شامل)';

export const DEV_INSPECTION_SECTIONS: readonly InspectionTemplateSection[] = [
  {
    key: 'engine',
    title_ar: 'المحرك',
    title_en: 'Engine',
    weight: 3,
    items: [
      {
        key: 'oil_leaks',
        label_ar: 'تسريب زيت',
        label_en: 'Oil leaks',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'cold_start',
        label_ar: 'التشغيل البارد',
        label_en: 'Cold start',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'idle',
        label_ar: 'ثبات الدوران',
        label_en: 'Idle stability',
        type: 'rating',
        required: true,
      },
      {
        key: 'noises',
        label_ar: 'أصوات غير طبيعية',
        label_en: 'Abnormal noises',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'smoke',
        label_ar: 'دخان العادم',
        label_en: 'Exhaust smoke',
        type: 'rating',
        required: true,
        weight: 2,
      },
      { key: 'belts', label_ar: 'السيور', label_en: 'Belts', type: 'rating', required: false },
    ],
  },
  {
    key: 'transmission',
    title_ar: 'ناقل الحركة',
    title_en: 'Transmission',
    weight: 3,
    items: [
      {
        key: 'shift_quality',
        label_ar: 'نعومة التعشيق',
        label_en: 'Shift quality',
        type: 'rating',
        required: true,
        weight: 3,
      },
      {
        key: 'slipping',
        label_ar: 'انزلاق الجير',
        label_en: 'Slipping',
        type: 'rating',
        required: true,
        weight: 3,
      },
      {
        key: 'fluid',
        label_ar: 'زيت الجير',
        label_en: 'Transmission fluid',
        type: 'rating',
        required: true,
      },
    ],
  },
  {
    key: 'brakes',
    title_ar: 'الفرامل',
    title_en: 'Brakes',
    weight: 3,
    items: [
      {
        key: 'pads',
        label_ar: 'الفحمات',
        label_en: 'Pads',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'discs',
        label_ar: 'الهوبات',
        label_en: 'Discs',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'abs',
        label_ar: 'نظام ABS',
        label_en: 'ABS',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'handbrake',
        label_ar: 'فرامل اليد',
        label_en: 'Handbrake',
        type: 'rating',
        required: false,
      },
    ],
  },
  {
    key: 'suspension',
    title_ar: 'التعليق',
    title_en: 'Suspension',
    weight: 2,
    items: [
      {
        key: 'shocks',
        label_ar: 'المساعدات',
        label_en: 'Shock absorbers',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'bushings',
        label_ar: 'الجلود والمساند',
        label_en: 'Bushings',
        type: 'rating',
        required: true,
      },
      {
        key: 'steering_play',
        label_ar: 'خلخلة الدركسيون',
        label_en: 'Steering play',
        type: 'rating',
        required: true,
        weight: 2,
      },
    ],
  },
  {
    key: 'electrical',
    title_ar: 'الكهرباء',
    title_en: 'Electrical',
    weight: 2,
    items: [
      { key: 'battery', label_ar: 'البطارية', label_en: 'Battery', type: 'rating', required: true },
      {
        key: 'alternator',
        label_ar: 'الدينمو',
        label_en: 'Alternator',
        type: 'rating',
        required: true,
        weight: 2,
      },
      { key: 'lights', label_ar: 'الإضاءة', label_en: 'Lights', type: 'rating', required: true },
      {
        key: 'windows',
        label_ar: 'النوافذ الكهربائية',
        label_en: 'Power windows',
        type: 'rating',
        required: false,
      },
    ],
  },
  {
    key: 'tyres',
    title_ar: 'الإطارات',
    title_en: 'Tyres',
    weight: 2,
    items: [
      {
        key: 'tread',
        label_ar: 'عمق النقشة',
        label_en: 'Tread depth',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'age',
        label_ar: 'عمر الإطارات',
        label_en: 'Tyre age',
        type: 'rating',
        required: true,
      },
      {
        key: 'uneven_wear',
        label_ar: 'تآكل غير منتظم',
        label_en: 'Uneven wear',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'spare',
        label_ar: 'الإطار الاحتياطي',
        label_en: 'Spare tyre',
        type: 'rating',
        required: false,
      },
    ],
  },
  {
    key: 'body_chassis',
    title_ar: 'الهيكل والشاسيه',
    title_en: 'Body and chassis',
    weight: 4,
    items: [
      {
        key: 'chassis_straight',
        label_ar: 'استقامة الشاسيه',
        label_en: 'Chassis alignment',
        type: 'rating',
        required: true,
        weight: 4,
        critical: true,
      },
      {
        key: 'weld_marks',
        label_ar: 'آثار لحام',
        label_en: 'Weld marks',
        type: 'rating',
        required: true,
        weight: 3,
      },
      {
        key: 'paint_thickness',
        label_ar: 'سماكة الدهان',
        label_en: 'Paint thickness',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'rust',
        label_ar: 'الصدأ',
        label_en: 'Rust',
        type: 'rating',
        required: true,
        weight: 2,
      },
      {
        key: 'panel_gaps',
        label_ar: 'فراغات القطع',
        label_en: 'Panel gaps',
        type: 'rating',
        required: true,
      },
    ],
  },
  {
    key: 'interior',
    title_ar: 'الفرش الداخلي',
    title_en: 'Interior',
    weight: 1,
    items: [
      { key: 'seats', label_ar: 'المقاعد', label_en: 'Seats', type: 'rating', required: true },
      {
        key: 'dashboard',
        label_ar: 'لوحة القيادة',
        label_en: 'Dashboard',
        type: 'rating',
        required: true,
      },
      { key: 'odour', label_ar: 'الروائح', label_en: 'Odours', type: 'rating', required: false },
    ],
  },
  {
    key: 'ac',
    title_ar: 'التكييف',
    title_en: 'Air conditioning',
    weight: 2,
    items: [
      {
        key: 'cooling',
        label_ar: 'كفاءة التبريد',
        label_en: 'Cooling performance',
        type: 'rating',
        required: true,
        weight: 3,
      },
      {
        key: 'compressor',
        label_ar: 'الكمبروسر',
        label_en: 'Compressor',
        type: 'rating',
        required: true,
        weight: 2,
      },
      { key: 'blower', label_ar: 'المروحة', label_en: 'Blower', type: 'rating', required: false },
    ],
  },
  {
    key: 'obd',
    title_ar: 'فحص الكمبيوتر',
    title_en: 'Computer diagnostics',
    weight: 3,
    items: [
      {
        key: 'stored_codes',
        label_ar: 'أكواد مخزّنة',
        label_en: 'Stored fault codes',
        type: 'rating',
        required: true,
        weight: 3,
      },
      {
        key: 'airbag_system',
        label_ar: 'نظام الوسائد الهوائية',
        label_en: 'Airbag system',
        type: 'rating',
        required: true,
        weight: 3,
      },
      {
        key: 'readiness',
        label_ar: 'جاهزية الأنظمة',
        label_en: 'Readiness monitors',
        type: 'rating',
        required: true,
      },
    ],
  },
  {
    key: 'history',
    title_ar: 'تاريخ الحوادث',
    title_en: 'Accident history',
    weight: 4,
    items: [
      {
        key: 'accident_evidence',
        label_ar: 'آثار حوادث',
        label_en: 'Evidence of accidents',
        type: 'rating',
        required: true,
        weight: 4,
        critical: true,
      },
      {
        key: 'airbag_deployed',
        label_ar: 'انفجار وسائد سابق',
        label_en: 'Previous airbag deployment',
        type: 'rating',
        required: true,
        weight: 4,
        critical: true,
      },
      {
        key: 'flood_damage',
        label_ar: 'آثار غرق',
        label_en: 'Flood damage',
        type: 'rating',
        required: true,
        weight: 4,
        critical: true,
      },
      {
        key: 'odometer_consistency',
        label_ar: 'منطقية العداد',
        label_en: 'Odometer consistency',
        type: 'rating',
        required: true,
        weight: 3,
        critical: true,
      },
    ],
  },
];
