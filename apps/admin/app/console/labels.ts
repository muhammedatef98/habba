/**
 * Every code the database speaks, in the Arabic the operator reads.
 *
 * One table per enum, with the tone its badge takes. Kept here rather than in
 * each screen so an order's status reads the same on the board, in the list
 * and in its file.
 */

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'brand';

export interface Label {
  readonly text: string;
  readonly tone: Tone;
}

export const ORDER_STATUS: Readonly<Record<string, Label>> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  searching: { text: 'جارٍ البحث', tone: 'warn' },
  quoted: { text: 'بانتظار القبول', tone: 'warn' },
  accepted: { text: 'مقبول', tone: 'info' },
  checked_in: { text: 'السيارة في الورشة', tone: 'info' },
  en_route: { text: 'الفنّي في الطريق', tone: 'info' },
  arrived: { text: 'وصل الفنّي', tone: 'info' },
  in_progress: { text: 'جارٍ العمل', tone: 'info' },
  awaiting_approval: { text: 'بانتظار اعتماد العميل', tone: 'warn' },
  completed: { text: 'مكتمل', tone: 'good' },
  cancelled: { text: 'ملغى', tone: 'neutral' },
  disputed: { text: 'شكوى مفتوحة', tone: 'bad' },
};

export const ORDER_STATUS_FILTERS: readonly { readonly value: string; readonly text: string }[] = [
  { value: '', text: 'كل الحالات' },
  { value: 'open', text: 'الجارية' },
  ...Object.entries(ORDER_STATUS).map(([value, label]) => ({ value, text: label.text })),
];

export const MODE: Readonly<Record<string, string>> = {
  mobile_ondemand: 'طارئ — فنّي متنقل',
  mobile_scheduled: 'موعد — فنّي متنقل',
  workshop: 'حجز ورشة',
};

export const ESCROW: Readonly<Record<string, Label>> = {
  none: { text: 'بلا دفع', tone: 'neutral' },
  authorised: { text: 'مبلغ محجوز', tone: 'info' },
  captured: { text: 'محصَّل', tone: 'good' },
  released: { text: 'أُفرج عن الحجز', tone: 'neutral' },
  refunded: { text: 'مسترد', tone: 'warn' },
  failed: { text: 'فشل الدفع', tone: 'bad' },
};

export const VERIFICATION: Readonly<Record<string, Label>> = {
  pending: { text: 'بانتظار المراجعة', tone: 'warn' },
  in_review: { text: 'قيد المراجعة', tone: 'info' },
  approved: { text: 'معتمد', tone: 'good' },
  rejected: { text: 'مرفوض', tone: 'bad' },
  suspended: { text: 'موقوف', tone: 'bad' },
};

export const ROLE: Readonly<Record<string, string>> = {
  customer: 'عميل',
  technician: 'فنّي',
  workshop_admin: 'مدير ورشة',
  ops: 'مشغّل',
  super_admin: 'مشرف عام',
};

export const PROVENANCE: Readonly<Record<string, Label>> = {
  habba_verified: { text: 'موثّق من هبّة', tone: 'good' },
  self_documented: { text: 'من المالك مع مرفق', tone: 'info' },
  self_reported: { text: 'من المالك', tone: 'neutral' },
  third_party: { text: 'جهة خارجية', tone: 'info' },
};

export const TIMELINE_EVENT: Readonly<Record<string, string>> = {
  vehicle_registered: 'تسجيل السيارة',
  service_completed: 'خدمة مكتملة',
  inspection_completed: 'فحص مكتمل',
  parts_replaced: 'تبديل قطع',
  mileage_recorded: 'قراءة عداد',
  warranty_claimed: 'مطالبة ضمان',
  ownership_transferred: 'نقل ملكية',
  alert_raised: 'تنبيه صيانة',
  alert_dismissed: 'تجاهل تنبيه',
  record_annotated: 'ملاحظة تصحيح من هبّة',
};

export const PAYMENT_OPERATION: Readonly<Record<string, Label>> = {
  pending: { text: 'بانتظار التنفيذ', tone: 'warn' },
  succeeded: { text: 'نُفّذ', tone: 'good' },
  failed: { text: 'فشل', tone: 'bad' },
};

export const PAYMENT_KIND: Readonly<Record<string, string>> = {
  void: 'إلغاء حجز المبلغ',
  refund: 'استرداد',
  capture: 'تحصيل المبلغ',
};

export const HOLD_KIND: Readonly<Record<string, string>> = {
  initial: 'حجز الطلب',
  top_up: 'حجز فرق الفاتورة',
};

export const HOLD_STATUS: Readonly<Record<string, Label>> = {
  authorised: { text: 'محجوز', tone: 'warn' },
  captured: { text: 'محصَّل', tone: 'good' },
  voided: { text: 'مُلغى', tone: 'neutral' },
  expired: { text: 'منتهي', tone: 'neutral' },
};

export const PAYOUT_STATUS: Readonly<Record<string, Label>> = {
  pending: { text: 'بانتظار الاعتماد', tone: 'warn' },
  approved: { text: 'معتمدة للتحويل', tone: 'info' },
  paid: { text: 'مدفوعة', tone: 'good' },
  failed: { text: 'فشل التحويل', tone: 'bad' },
};

export const RESOLUTION: Readonly<Record<string, string>> = {
  upheld: 'العمل سليم — لا استرداد',
  partial_refund: 'استرداد جزئي',
  full_refund: 'استرداد كامل',
};

export const TRANSFER_STATUS: Readonly<Record<string, Label>> = {
  pending: { text: 'بانتظار القبول', tone: 'warn' },
  accepted: { text: 'مقبول', tone: 'good' },
  expired: { text: 'منتهي', tone: 'neutral' },
  cancelled: { text: 'ملغى', tone: 'neutral' },
};

export const SETTING_CATEGORY: Readonly<Record<string, string>> = {
  app: 'التطبيق',
  dispatch: 'البحث عن فنّي',
  ops: 'لوحة التشغيل',
  security: 'الأمان',
  transfer: 'نقل الملكية',
  care: 'العناية بالسيارة',
  payments: 'الدفع',
  features: 'ميزات التطبيق',
};

export const AUDIT_ACTION: Readonly<Record<string, string>> = {
  insert: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  read: 'اطّلاع على ملف',
};

export const TABLE_NAME: Readonly<Record<string, string>> = {
  providers: 'مقدّم خدمة',
  orders: 'طلب',
  services: 'خدمة',
  payouts: 'دفعة مستحقات',
  user_roles: 'صلاحية',
  commission_rates: 'نسبة عمولة',
  cities: 'مدينة',
  vehicle_timeline: 'دفتر سيارة',
  platform_settings: 'إعداد',
  account_suspensions: 'إيقاف حساب',
  payment_operations: 'عملية دفع',
  order_disputes: 'شكوى',
  ratings: 'تقييم',
  ops_notes: 'ملاحظة داخلية',
  ops_broadcasts: 'إشعار جماعي',
  data_requests: 'طلب بيانات',
  vat_rates: 'نسبة ضريبة',
  profiles: 'حساب',
  vehicles: 'سيارة',
  habba_reports: 'تقرير هبّة',
  ownership_transfers: 'نقل ملكية',
  provider_services: 'خدمات مقدّم',
  workshops: 'ورشة',
  appointment_slots: 'موعد',
  order_parts: 'قطعة غيار',
  vehicle_makes: 'ماركة',
  vehicle_models: 'طراز',
  maintenance_rules: 'قاعدة صيانة',
  maintenance_item_types: 'بند صيانة',
  inspection_templates: 'نموذج فحص',
  invoice_sellers: 'بائع فوترة',
  zatca_invoices: 'فاتورة ضريبية',
};

export function label(map: Readonly<Record<string, Label>>, key: string | null | undefined): Label {
  return (
    (key !== null && key !== undefined ? map[key] : undefined) ?? {
      text: key ?? '—',
      tone: 'neutral',
    }
  );
}
