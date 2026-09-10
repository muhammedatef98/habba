/**
 * Arabic labels and formatting shared by every rendering of تقرير هبّة.
 *
 * Two renderers exist — the HTML page (`render.ts`) and the printable PDF
 * (`pdf.ts`) — and a buyer may see both. If «موثّق من هبّة» became «موثوق»
 * in one of them, or a part number lost its label in the other, the two
 * documents would be describing the same car in two vocabularies. So the words
 * live here once.
 */

/**
 * Escapes text for HTML.
 *
 * Reports render owner-typed strings (service descriptions) into a document
 * other people read. Without escaping, an owner could inject markup into a
 * page a buyer trusts.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Latin numerals: §8 notes Saudi users prefer 1234 over ١٢٣٤ on screen and on paper. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export const PROVENANCE_LABEL_AR = {
  habba_verified: 'موثّق من هبّة',
  self_documented: 'مُدخل من المالك مع مرفق',
  self_reported: 'مُدخل من المالك',
  third_party: 'من جهة خارجية',
} as const;

export const DETAIL_LABEL_AR: Readonly<Record<string, string>> = {
  oil_grade: 'درجة الزيت',
  oil_quantity_l: 'كمية الزيت (لتر)',
  filter_part_number: 'رقم الفلتر',
  part_number: 'رقم القطعة',
  is_oem: 'قطعة أصلية',
  warranty_days: 'الضمان (يوم)',
  labour_hours: 'ساعات العمل',
  service_kind: 'نوع الخدمة',
  inspection_score: 'نتيجة الفحص',
  obd_codes: 'أكواد الكمبيوتر',
  tyre_size: 'مقاس الإطار',
  battery_capacity_ah: 'سعة البطارية',
  brake_pad_position: 'موضع الفحمات',
  notes_public: 'ملاحظات',
};

export const WARRANTY_STATUS_LABEL_AR = {
  active: 'ساري',
  expired: 'منتهٍ',
} as const;

/**
 * The word a buyer acts on. Thresholds are `score_to_recommendation` in
 * migration 0026 — product policy, applied server-side, never re-derived here.
 */
export const RECOMMENDATION_LABEL_AR = {
  buy: 'صالحة للشراء',
  negotiate: 'قابلة للتفاوض على السعر',
  avoid: 'يُنصح بتجنّبها',
} as const;

/**
 * The four Arabic forms a counted noun takes.
 *
 * Arabic does not have English's one/other split: «٢ سجل» is wrong the way
 * "2 record" is wrong in English, and this document is the artefact a seller
 * hands to a buyer. The rule for 1–10 and 11+ is regular enough to encode,
 * and the four forms are supplied by the caller because the noun's dual and
 * plural are not derivable from its singular.
 */
export interface ArabicCountForms {
  /** ١ — «سجل واحد» */
  readonly one: string;
  /** ٢ — «سجلان» */
  readonly two: string;
  /** ٣–١٠, the broken plural — «سجلات» */
  readonly few: string;
  /** ١١+, back to the singular in the accusative — «سجلاً» */
  readonly many: string;
  /** ٠ — «لا سجلات» */
  readonly none: string;
}

export function arabicCount(count: number, forms: ArabicCountForms): string {
  if (count === 0) return forms.none;
  if (count === 1) return forms.one;
  if (count === 2) return forms.two;
  if (count <= 10) return `${formatNumber(count)} ${forms.few}`;
  return `${formatNumber(count)} ${forms.many}`;
}

export const RECORD_FORMS: ArabicCountForms = {
  none: 'لا سجلات',
  one: 'سجل واحد',
  two: 'سجلان',
  few: 'سجلات',
  many: 'سجلاً',
};

export const ATTACHMENT_FORMS: ArabicCountForms = {
  none: 'بدون مرفقات',
  one: 'مرفق واحد',
  two: 'مرفقان',
  few: 'مرفقات',
  many: 'مرفقاً',
};

export const DAY_FORMS: ArabicCountForms = {
  none: 'بدون أيام',
  one: 'يوم واحد',
  two: 'يومان',
  few: 'أيام',
  many: 'يوماً',
};

export const MONTH_FORMS: ArabicCountForms = {
  none: 'أقل من شهر',
  one: 'شهر واحد',
  two: 'شهران',
  few: 'أشهر',
  many: 'شهراً',
};

export function formatDetailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return formatNumber(value);
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join('، ');
  return String(value);
}
