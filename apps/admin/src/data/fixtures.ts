/**
 * Demo data for the console when no project is connected.
 *
 * Every screen can be reached and reviewed before a Supabase project exists
 * (ADR-0010). The console says plainly when it is in this mode; nothing here
 * pretends to be production data, and nothing done here is saved anywhere.
 *
 * The handlers mirror the server's rules where a screen depends on them — an
 * action without a reason is refused, a paid payout is final — so the screens
 * behave the same way in both modes. They are not a second implementation of
 * the rules; the SQL suites prove those.
 */

import { ApiError, type ListOptions, type Row, type Transport } from './transport';
import type {
  Dashboard,
  DisputeRow,
  OrderFile,
  OrderRow,
  OrderStatus,
  PaymentOperation,
  Payout,
  ProviderFile,
  ProviderRow,
  RatingRow,
  SearchHit,
  StaffMember,
  UserFile,
  UserRow,
  VehicleFile,
} from './types';

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

const CUSTOMER = 'u-customer-1';
const CUSTOMER_2 = 'u-customer-2';
const TECH = 'u-tech-1';
const WORKSHOP_OWNER = 'u-workshop-1';
const OPERATOR = 'ops-dev-1';

interface State {
  orders: OrderFile[];
  users: UserFile[];
  providers: ProviderFile[];
  vehicles: VehicleFile[];
  ratings: RatingRow[];
  paymentOperations: PaymentOperation[];
  payouts: Payout[];
  staff: StaffMember[];
  tables: Record<string, Row[]>;
  records: Record<string, Row[]>;
  auditSeq: number;
}

function reasonOf(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 3) throw new ApiError('A reason is required', '23514', null);
  return reason;
}

function baseOrder(
  id: string,
  number: string,
  status: OrderStatus,
  service: string,
  minutesAgo: number,
  total: number | null,
): OrderFile {
  return {
    order: {
      id,
      order_number: number,
      status,
      fulfilment_mode: 'mobile_ondemand',
      service_address_ar: 'حي الشاطئ، الدمام',
      problem_description: 'السيارة لا تشتغل صباحاً',
      scheduled_for: null,
      quoted_amount: total === null ? 180 : Math.round((total / 1.15) * 100) / 100,
      labour_amount: total === null ? 0 : Math.round((total / 1.15) * 100) / 100,
      parts_amount: 0,
      vat_amount: total === null ? 0 : Math.round((total - total / 1.15) * 100) / 100,
      total_amount: total,
      refunded_amount: 0,
      escrow_status: status === 'completed' || status === 'disputed' ? 'captured' : 'authorised',
      payment_intent_id: `pi_demo_${number}`,
      warranty_days: status === 'completed' || status === 'disputed' ? 30 : null,
      warranty_expires_at: null,
      dispatch_round: status === 'searching' ? 3 : 1,
      mileage_at_order: 84_200,
      completion_mileage: null,
      completion_media: [],
      triage_media: [],
      cancellation_reason: null,
      completed_at: status === 'completed' || status === 'disputed' ? ago(minutesAgo - 30) : null,
      cancelled_at: null,
      created_at: ago(minutesAgo),
      lat: 26.4207,
      lon: 50.1033,
    },
    service: { id: 'svc-battery', name_ar: service, category: 'battery' },
    customer: {
      id: CUSTOMER,
      full_name: 'سارة القحطاني',
      phone: '+966501234567',
      email: null,
      suspended: false,
    },
    provider:
      status === 'searching'
        ? null
        : {
            id: 'prov-1',
            business_name_ar: 'ونش الشرقية السريع',
            provider_type: 'individual',
            owner_profile_id: TECH,
            phone: '+966551112233',
            verification_status: 'approved',
            rating_avg: 4.6,
            is_online: true,
          },
    vehicle: {
      id: 'veh-1',
      plate_ar: 'أ ب ج ١٢٣٤',
      plate_en: 'A B J 1234',
      vin: 'JTDBR32E520123456',
      year: 2019,
      make_ar: 'تويوتا',
      model_ar: 'كامري',
    },
    events: [
      {
        from: 'draft',
        to: 'searching',
        actor_name: 'سارة القحطاني',
        note: null,
        at: ago(minutesAgo),
      },
      ...(status === 'searching'
        ? []
        : [
            {
              from: 'searching' as const,
              to: 'accepted' as const,
              actor_name: 'ونش الشرقية السريع',
              note: null,
              at: ago(minutesAgo - 2),
            },
          ]),
    ],
    parts: [],
    offers: [
      {
        provider_id: 'prov-1',
        provider_name_ar: 'ونش الشرقية السريع',
        round: 1,
        radius_m: 8000,
        sent_at: ago(minutesAgo),
        viewed_at: ago(minutesAgo - 1),
        responded_at: status === 'searching' ? null : ago(minutesAgo - 2),
        outcome: status === 'searching' ? 'expired' : 'accepted',
      },
    ],
    handover: null,
    rating: null,
    invoices: [],
    disputes: [],
    payment_operations: [],
    payout: null,
    parent_order: null,
    notes: [],
  };
}

function seed(): State {
  const disputed = baseOrder(
    'ord-4',
    'HB-2026-000377',
    'disputed',
    'بطارية — شحن أو تبديل',
    2_900,
    230,
  );
  const orders: OrderFile[] = [
    baseOrder('ord-1', 'HB-2026-000412', 'searching', 'ونش/سحب', 9, null),
    baseOrder('ord-2', 'HB-2026-000418', 'awaiting_approval', 'بنشر وتبديل إطار', 55, 115),
    baseOrder('ord-3', 'HB-2026-000390', 'completed', 'تغيير زيت وفلتر', 1_500, 207),
    {
      ...disputed,
      disputes: [
        {
          id: 'disp-1',
          order_id: 'ord-4',
          reason: 'البطارية الجديدة فصلت بعد يومين',
          opened_at: ago(600),
          resolution: null,
          refund_amount: null,
          resolution_note: null,
          resolved_at: null,
          payout_already_built: false,
        },
      ],
    },
  ];

  const vehicles: VehicleFile[] = [
    {
      vehicle: {
        id: 'veh-1',
        plate_ar: 'أ ب ج ١٢٣٤',
        plate_en: 'A B J 1234',
        vin: 'JTDBR32E520123456',
        year: 2019,
        colour: 'أبيض',
        nickname: 'سيارة العائلة',
        current_mileage: 84_200,
        is_active: true,
        created_at: ago(90 * 24 * 60),
        make_ar: 'تويوتا',
        model_ar: 'كامري',
      },
      owner: { id: CUSTOMER, full_name: 'سارة القحطاني', phone: '+966501234567' },
      timeline: [
        {
          id: 'tl-2',
          seq: 2,
          event_type: 'service_completed',
          occurred_at: ago(1_470),
          mileage: 84_150,
          provenance: 'habba_verified',
          summary_ar: 'تغيير زيت وفلتر',
          order_id: 'ord-3',
          attachments: 2,
          row_hash: '9f2c…a41b',
        },
        {
          id: 'tl-1',
          seq: 1,
          event_type: 'vehicle_registered',
          occurred_at: ago(90 * 24 * 60),
          mileage: 80_000,
          provenance: 'habba_verified',
          summary_ar: 'تم تسجيل السيارة في هبّة',
          order_id: null,
          attachments: 0,
          row_hash: '41aa…07cd',
        },
      ],
      transfers: [],
      reports: [
        {
          id: 'rep-1',
          generated_at: ago(3_000),
          expires_at: null,
          revoked_at: null,
          chain_valid: true,
          chain_length: 2,
        },
      ],
      documents: [],
      orders: orders.map((order) => ({
        id: order.order.id,
        order_number: order.order.order_number,
        status: order.order.status,
        service_name_ar: order.service.name_ar,
        amount: order.order.total_amount,
        created_at: order.order.created_at,
      })),
      notes: [],
    },
  ];

  const users: UserFile[] = [
    {
      profile: {
        id: CUSTOMER,
        full_name: 'سارة القحطاني',
        phone: '+966501234567',
        email: 'sara@example.com',
        is_guest: false,
        preferred_locale: 'ar',
        created_at: ago(90 * 24 * 60),
      },
      roles: [
        {
          role: 'customer',
          granted_at: ago(90 * 24 * 60),
          revoked_at: null,
          granted_by_name: null,
        },
      ],
      suspensions: [],
      suspended: false,
      vehicles: [
        {
          id: 'veh-1',
          plate_ar: 'أ ب ج ١٢٣٤',
          plate_en: 'A B J 1234',
          year: 2019,
          make_ar: 'تويوتا',
          model_ar: 'كامري',
          is_active: true,
          current_mileage: 84_200,
        },
      ],
      orders: vehicles[0]?.orders ?? [],
      provider: null,
      devices: [{ platform: 'ios', last_seen_at: ago(30), disabled_at: null }],
      transfers: [],
      ratings_given: 1,
      data_requests: [],
      notes: [],
    },
    {
      profile: {
        id: CUSTOMER_2,
        full_name: 'فهد الدوسري',
        phone: '+966507654321',
        email: null,
        is_guest: false,
        preferred_locale: 'ar',
        created_at: ago(5 * 24 * 60),
      },
      roles: [
        { role: 'customer', granted_at: ago(5 * 24 * 60), revoked_at: null, granted_by_name: null },
      ],
      suspensions: [],
      suspended: false,
      vehicles: [],
      orders: [],
      provider: null,
      devices: [],
      transfers: [],
      ratings_given: 0,
      data_requests: [],
      notes: [],
    },
    {
      profile: {
        id: TECH,
        full_name: 'ماجد العتيبي',
        phone: '+966551112233',
        email: null,
        is_guest: false,
        preferred_locale: 'ar',
        created_at: ago(40 * 24 * 60),
      },
      roles: [
        {
          role: 'customer',
          granted_at: ago(40 * 24 * 60),
          revoked_at: null,
          granted_by_name: null,
        },
        {
          role: 'technician',
          granted_at: ago(30 * 24 * 60),
          revoked_at: null,
          granted_by_name: 'مشغّل التطوير',
        },
      ],
      suspensions: [],
      suspended: false,
      vehicles: [],
      orders: [],
      provider: {
        id: 'prov-1',
        business_name_ar: 'ونش الشرقية السريع',
        verification_status: 'approved',
      },
      devices: [{ platform: 'android', last_seen_at: ago(3), disabled_at: null }],
      transfers: [],
      ratings_given: 0,
      data_requests: [],
      notes: [],
    },
    {
      profile: {
        id: WORKSHOP_OWNER,
        full_name: 'عبدالله الشهري',
        phone: '+966559998877',
        email: 'info@alwurud.sa',
        is_guest: false,
        preferred_locale: 'ar',
        created_at: ago(3 * 24 * 60),
      },
      roles: [
        { role: 'customer', granted_at: ago(3 * 24 * 60), revoked_at: null, granted_by_name: null },
      ],
      suspensions: [],
      suspended: false,
      vehicles: [],
      orders: [],
      provider: { id: 'prov-2', business_name_ar: 'ورشة الورود', verification_status: 'pending' },
      devices: [],
      transfers: [],
      ratings_given: 0,
      data_requests: [],
      notes: [],
    },
  ];

  const services = [
    {
      service_id: 'svc-battery',
      name_ar: 'بطارية — شحن أو تبديل',
      base_price: 150,
      custom_price: null,
      offered: true,
    },
    {
      service_id: 'svc-tow',
      name_ar: 'ونش/سحب',
      base_price: 250,
      custom_price: 230,
      offered: true,
    },
    {
      service_id: 'svc-oil',
      name_ar: 'تغيير زيت وفلتر',
      base_price: 180,
      custom_price: null,
      offered: false,
    },
  ];

  const providerBase = (
    id: string,
    name: string,
    type: 'individual' | 'workshop',
    status: ProviderFile['provider']['verification_status'],
    owner: UserFile,
    nafath: string | null,
  ): ProviderFile => ({
    provider: {
      id,
      business_name_ar: name,
      business_name_en: null,
      provider_type: type,
      cr_number: type === 'workshop' ? '2050012345' : null,
      vat_number: null,
      verification_status: status,
      nafath_verified_at: nafath,
      rating_avg: status === 'approved' ? 4.6 : 0,
      rating_count: status === 'approved' ? 23 : 0,
      jobs_completed: status === 'approved' ? 41 : 0,
      acceptance_rate: status === 'approved' ? 88 : null,
      is_online: status === 'approved',
      created_at: owner.profile.created_at,
      has_national_id: true,
      has_iban: status === 'approved',
    },
    owner: {
      id: owner.profile.id,
      full_name: owner.profile.full_name,
      phone: owner.profile.phone,
      email: owner.profile.email,
      suspended: false,
    },
    city: { id: 'city-dammam', name_ar: type === 'workshop' ? 'الرياض' : 'الدمام' },
    services,
    workshop:
      type === 'workshop'
        ? { address_ar: 'طريق الملك فهد، الرياض', bay_count: 3, service_radius_km: null }
        : null,
    location: status === 'approved' ? { lat: 26.42, lon: 50.1, updated_at: ago(1) } : null,
    verification_events: [],
    ratings: [],
    orders: [],
    stats: {
      completed: status === 'approved' ? 41 : 0,
      cancelled: status === 'approved' ? 3 : 0,
      disputed: status === 'approved' ? 1 : 0,
      earned: status === 'approved' ? 9_840.5 : 0,
      offers_sent: status === 'approved' ? 57 : 0,
      offers_accepted: status === 'approved' ? 44 : 0,
    },
    payouts: [],
    notes: [],
  });

  const providers: ProviderFile[] = [
    providerBase(
      'prov-1',
      'ونش الشرقية السريع',
      'individual',
      'approved',
      users[2] as UserFile,
      ago(30 * 24 * 60),
    ),
    providerBase('prov-2', 'ورشة الورود', 'workshop', 'pending', users[3] as UserFile, null),
  ];

  const ratings: RatingRow[] = [
    {
      id: 'rat-1',
      order_id: 'ord-3',
      order_number: 'HB-2026-000390',
      stars: 5,
      comment: 'وصل بسرعة وشغله نظيف',
      tags: ['punctual'],
      created_at: ago(1_400),
      hidden_at: null,
      hidden_reason: null,
      rater_name: 'سارة القحطاني',
      provider_name_ar: 'ونش الشرقية السريع',
      provider_id: 'prov-1',
    },
  ];

  const payouts: Payout[] = [
    {
      id: 'pay-1',
      provider_id: 'prov-1',
      period_start: '2026-09-01',
      period_end: '2026-09-15',
      gross_amount: 2_415,
      commission: 420,
      net_amount: 1_995,
      order_count: 12,
      status: 'pending',
      paid_at: null,
      reference: null,
      created_at: ago(8 * 24 * 60),
      provider_name_ar: 'ونش الشرقية السريع',
      provider_has_iban: true,
    },
  ];

  const settings: Row[] = [
    setting(
      'new_orders_paused',
      false,
      'boolean',
      'app',
      'إيقاف استقبال الطلبات الجديدة',
      null,
      true,
      10,
      'عند التفعيل لا يستطيع أحد إرسال طلب جديد. الطلبات الجارية تكمل طبيعياً.',
    ),
    setting(
      'new_orders_paused_message_ar',
      'نعتذر، استقبال الطلبات متوقف مؤقتاً. حاول بعد قليل.',
      'text',
      'app',
      'رسالة الإيقاف للعملاء',
      null,
      true,
      20,
    ),
    setting(
      'announcement_ar',
      '',
      'text',
      'app',
      'إعلان يظهر أعلى الصفحة الرئيسية',
      null,
      true,
      30,
      'اتركه فارغاً لإخفاء الإعلان.',
    ),
    setting('support_phone', '', 'text', 'app', 'هاتف الدعم', null, true, 50),
    setting(
      'dispute_window_days',
      14,
      'integer',
      'app',
      'مدة فتح شكوى بعد اكتمال الطلب',
      'يوم',
      true,
      90,
      null,
      1,
      365,
    ),
    setting(
      'dispatch_max_round',
      3,
      'integer',
      'dispatch',
      'عدد جولات البحث عن فنّي',
      'جولة',
      false,
      10,
      'كل جولة توسّع نطاق البحث.',
      1,
      10,
    ),
    setting(
      'dispatch_silence_seconds',
      45,
      'integer',
      'dispatch',
      'مهلة الجولة قبل التوسيع',
      'ثانية',
      false,
      20,
      null,
      10,
      600,
    ),
    setting(
      'match_radius_round1_m',
      8000,
      'integer',
      'dispatch',
      'نطاق الجولة الأولى',
      'متر',
      false,
      30,
      null,
      500,
      100000,
    ),
    setting(
      'auto_complete_after_hours',
      24,
      'integer',
      'ops',
      'الإقفال التلقائي بعد تسليم العمل',
      'ساعة',
      true,
      30,
      'إن لم يعتمد العميل العمل ولم يشتكِ خلال هذه المدة يُقفل الطلب ويُحصَّل المبلغ. يُذكَّر في منتصفها.',
      2,
      168,
    ),
    setting(
      'ops_stuck_search_minutes',
      4,
      'integer',
      'ops',
      'تنبيه البحث البطيء بعد',
      'دقيقة',
      false,
      10,
      null,
      1,
      120,
    ),
    setting(
      'otp_send_limit',
      5,
      'integer',
      'security',
      'أقصى عدد لرسائل رمز الدخول',
      'رسالة',
      false,
      10,
      'لكل رقم خلال النافذة التالية.',
      1,
      50,
    ),
    setting(
      'care_lead_days',
      14,
      'integer',
      'care',
      'التذكير قبل موعد الصيانة',
      'يوم',
      false,
      10,
      null,
      1,
      90,
    ),
  ];

  return {
    orders,
    users,
    providers,
    vehicles,
    ratings,
    paymentOperations: [
      {
        id: 'po-1',
        order_id: 'ord-5',
        kind: 'void',
        amount: 172.5,
        status: 'pending',
        reason: 'إلغاء الطلب',
        created_at: ago(90),
        processed_at: null,
        psp_reference: null,
        last_error: null,
        order_number: 'HB-2026-000420',
        payment_intent_id: 'pi_demo_420',
        customer_name: 'فهد الدوسري',
        requested_by_name: 'فهد الدوسري',
      },
    ],
    payouts,
    staff: [
      {
        user_id: OPERATOR,
        full_name: 'مشغّل التطوير',
        email: 'ops@habba.sa',
        phone: null,
        role: 'ops',
        granted_at: ago(60 * 24 * 60),
        granted_by_name: null,
      },
    ],
    tables: {
      platform_settings: settings,
      services: [
        catalogue('svc-battery', {
          supported_modes: ['mobile_ondemand', 'mobile_scheduled'],
          name_ar: 'بطارية — شحن أو تبديل',
          name_en: 'Battery jump or replacement',
          category: 'battery',
          base_price: 150,
          est_duration_min: 30,
          is_active: true,
          sort_order: 1,
        }),
        catalogue('svc-tow', {
          supported_modes: ['mobile_ondemand', 'mobile_scheduled'],
          name_ar: 'ونش/سحب',
          name_en: 'Tow',
          category: 'towing',
          base_price: 250,
          est_duration_min: 45,
          is_active: true,
          sort_order: 2,
        }),
        catalogue('svc-oil', {
          supported_modes: ['mobile_ondemand', 'mobile_scheduled'],
          name_ar: 'تغيير زيت وفلتر',
          name_en: 'Oil and filter change',
          category: 'maintenance',
          base_price: 180,
          est_duration_min: 40,
          is_active: true,
          sort_order: 3,
        }),
        catalogue('svc-inspection', {
          supported_modes: ['mobile_scheduled', 'workshop'],
          name_ar: 'فحص قبل الشراء (شامل)',
          name_en: 'Pre-purchase inspection',
          category: 'inspection',
          base_price: 350,
          est_duration_min: 90,
          requires_vehicle: false,
          inspection_template_key: 'pre_purchase_v1',
          is_active: true,
          sort_order: 4,
        }),
      ],
      cities: [
        catalogue('city-dammam', {
          name_ar: 'الدمام',
          name_en: 'Dammam',
          region_ar: 'الشرقية',
          region_en: 'Eastern',
          is_active: true,
        }),
        catalogue('city-riyadh', {
          name_ar: 'الرياض',
          name_en: 'Riyadh',
          region_ar: 'الرياض',
          region_en: 'Riyadh',
          is_active: true,
        }),
      ],
      vehicle_makes: [
        catalogue('mk-1', { name_ar: 'تويوتا', name_en: 'Toyota', sort_order: 1, is_active: true }),
        catalogue('mk-2', {
          name_ar: 'هيونداي',
          name_en: 'Hyundai',
          sort_order: 2,
          is_active: true,
        }),
      ],
      vehicle_models: [
        catalogue('md-1', {
          make_id: 'mk-1',
          name_ar: 'كامري',
          name_en: 'Camry',
          year_from: 2000,
          year_to: null,
          is_active: true,
        }),
      ],
      commission_rates: [
        catalogue('cr-1', { category: null, rate: 0.2, valid_from: '2026-01-01', valid_to: null }),
      ],
      vat_rates: [catalogue('vat-1', { rate: 0.15, valid_from: '2020-07-01', valid_to: null })],
      invoice_sellers: [
        catalogue('is-1', {
          legal_name_ar: 'شركة هبّة',
          vat_number: '300000000000003',
          cr_number: null,
          provider_id: null,
          is_active: true,
        }),
      ],
      maintenance_item_types: [
        {
          item_type: 'engine_oil',
          name_ar: 'زيت المحرك',
          name_en: 'Engine oil',
          default_interval_km: 5000,
          default_interval_months: 6,
          sort_order: 1,
          is_active: true,
        },
      ],
      maintenance_rules: [],
      inspection_templates: [
        catalogue('it-1', {
          key: 'pre_purchase_v1',
          name_ar: 'فحص ما قبل الشراء (شامل)',
          name_en: 'Pre-purchase inspection (comprehensive)',
          sections: [],
          is_active: true,
        }),
      ],
      profiles: [
        ...users.map((user) => ({ id: user.profile.id, full_name: user.profile.full_name })),
        { id: OPERATOR, full_name: 'مشغّل التطوير' },
      ],
      audit_log: [],
    },
    records: {
      broadcasts: [],
      data_requests: [],
      transfers: [],
      reports: [
        {
          id: 'rep-1',
          vehicle_id: 'veh-1',
          plate_ar: 'أ ب ج ١٢٣٤',
          generated_at: ago(3_000),
          expires_at: null,
          revoked_at: null,
          chain_valid: true,
          chain_length: 2,
        },
      ],
      notifications: [
        {
          id: 'n-1',
          kind: 'order_accepted',
          title_ar: 'تم قبول طلبك',
          user_name: 'سارة القحطاني',
          created_at: ago(53),
          sent_at: ago(53),
          delivered_at: ago(52),
          abandoned_at: null,
          attempts: 1,
          last_error: null,
          expires_at: ago(23),
        },
      ],
    },
    auditSeq: 0,
  };
}

function setting(
  key: string,
  value: unknown,
  valueType: 'integer' | 'number' | 'boolean' | 'text',
  category: string,
  label: string,
  unit: string | null,
  isPublic: boolean,
  sortOrder: number,
  description: string | null = null,
  min: number | null = null,
  max: number | null = null,
): Row {
  return {
    key,
    value,
    value_type: valueType,
    min_value: min,
    max_value: max,
    is_public: isPublic,
    category,
    label_ar: label,
    unit_ar: unit,
    description_ar: description,
    sort_order: sortOrder,
    updated_at: ago(24 * 60),
  };
}

function catalogue(id: string, fields: Row): Row {
  return { id, created_at: ago(30 * 24 * 60), ...fields };
}

function orderRow(file: OrderFile): OrderRow {
  return {
    id: file.order.id,
    order_number: file.order.order_number,
    status: file.order.status,
    fulfilment_mode: file.order.fulfilment_mode,
    service_name_ar: file.service.name_ar,
    customer_id: file.customer?.id ?? '',
    customer_name: file.customer?.full_name ?? '',
    customer_phone: file.customer?.phone ?? null,
    provider_id: file.provider?.id ?? null,
    provider_name_ar: file.provider?.business_name_ar ?? null,
    total_amount: file.order.total_amount ?? file.order.quoted_amount,
    refunded_amount: file.order.refunded_amount,
    escrow_status: file.order.escrow_status,
    created_at: file.order.created_at,
    total_count: 0,
  };
}

function page<T extends { total_count: number }>(rows: readonly T[], args: Row): T[] {
  const offset = Number(args['p_offset'] ?? 0);
  const limit = Number(args['p_limit'] ?? 50);
  return rows.slice(offset, offset + limit).map((row) => ({ ...row, total_count: rows.length }));
}

function includes(value: string | null | undefined, query: unknown): boolean {
  if (typeof query !== 'string' || query.trim() === '') return true;
  return (value ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

export class FixtureTransport implements Transport {
  private readonly state: State = seed();

  private audit(action: string, table: string, id: string, after: Row): void {
    this.state.auditSeq += 1;
    (this.state.tables['audit_log'] as Row[]).unshift({
      id: this.state.auditSeq,
      actor_id: OPERATOR,
      action,
      target_table: table,
      target_id: id,
      before: null,
      after,
      ip: null,
      at: new Date().toISOString(),
    });
  }

  private orderFile(id: unknown): OrderFile {
    const file = this.state.orders.find((candidate) => candidate.order.id === id);
    if (file === undefined) throw new ApiError('Order not found', 'P0002', null);
    return file;
  }

  private setOrder(id: string, patch: Partial<OrderFile['order']>, extra: Partial<OrderFile> = {}) {
    this.state.orders = this.state.orders.map((file) =>
      file.order.id === id ? { ...file, ...extra, order: { ...file.order, ...patch } } : file,
    );
    this.audit('update', 'orders', id, patch as Row);
  }

  async rpc<T>(fn: string, args: Readonly<Record<string, unknown>> = {}): Promise<T> {
    return this.handle(fn, args as Row) as T;
  }

  private handle(fn: string, args: Row): unknown {
    const s = this.state;
    switch (fn) {
      case 'ops_dashboard': {
        const days = Array.from({ length: 14 }, (_, index) => {
          const day = new Date(now - (13 - index) * 86_400_000);
          return {
            day: day.toISOString().slice(0, 10),
            orders: 8 + ((index * 7) % 11),
            completed: 6 + ((index * 5) % 9),
            gmv: 1_200 + ((index * 431) % 1_600),
          };
        });
        const dashboard: Dashboard = {
          orders_today: 14,
          completed_today: 9,
          active_now: s.orders.filter(
            (o) => !['completed', 'cancelled', 'draft'].includes(o.order.status),
          ).length,
          searching_now: s.orders.filter((o) => o.order.status === 'searching').length,
          disputes_open: s.orders.filter((o) => o.order.status === 'disputed').length,
          gmv_today: 2_184.5,
          gmv_7d: 16_420,
          gmv_30d: 61_905.75,
          orders_7d: 96,
          cancelled_7d: 7,
          providers_online: s.providers.filter((p) => p.provider.is_online).length,
          providers_approved: s.providers.filter(
            (p) => p.provider.verification_status === 'approved',
          ).length,
          pending_verifications: s.providers.filter((p) =>
            ['pending', 'in_review'].includes(p.provider.verification_status),
          ).length,
          customers_total: 1_284,
          customers_new_7d: 63,
          vehicles_total: 1_502,
          pending_payment_operations: s.paymentOperations.filter((p) => p.status === 'pending')
            .length,
          suspended_accounts: s.users.filter((u) => u.suspended).length,
          avg_rating_30d: 4.52,
          new_orders_paused: (s.tables['platform_settings'] ?? []).some(
            (row) => row['key'] === 'new_orders_paused' && row['value'] === true,
          ),
          by_day: days,
        };
        return dashboard;
      }

      case 'ops_search': {
        const q = String(args['p_query'] ?? '').trim();
        if (q.length < 2) return [];
        const hits: SearchHit[] = [
          ...s.orders
            .filter((o) => includes(o.order.order_number, q))
            .map((o) => ({
              kind: 'order' as const,
              id: o.order.id,
              title: o.order.order_number,
              subtitle: o.service.name_ar,
              status: o.order.status,
            })),
          ...s.users
            .filter(
              (u) =>
                includes(u.profile.full_name, q) || includes(u.profile.phone, q.replace(/^0/, '')),
            )
            .map((u) => ({
              kind: 'user' as const,
              id: u.profile.id,
              title: u.profile.full_name,
              subtitle: u.profile.phone ?? '',
              status: u.suspended ? 'suspended' : 'active',
            })),
          ...s.vehicles
            .filter(
              (v) =>
                includes(v.vehicle.plate_en.replace(/\s/g, ''), q.replace(/\s/g, '')) ||
                includes(v.vehicle.plate_ar, q),
            )
            .map((v) => ({
              kind: 'vehicle' as const,
              id: v.vehicle.id,
              title: `${v.vehicle.plate_ar} · ${v.vehicle.plate_en}`,
              subtitle: `${v.vehicle.make_ar ?? ''} ${v.vehicle.model_ar ?? ''}`,
              status: 'active',
            })),
          ...s.providers
            .filter((p) => includes(p.provider.business_name_ar, q))
            .map((p) => ({
              kind: 'provider' as const,
              id: p.provider.id,
              title: p.provider.business_name_ar,
              subtitle: p.provider.provider_type === 'workshop' ? 'ورشة' : 'فنّي',
              status: p.provider.verification_status,
            })),
        ];
        return hits;
      }

      case 'ops_active_orders':
        return s.orders
          .filter((o) => !['completed', 'cancelled', 'draft'].includes(o.order.status))
          .map((o) => ({
            order_id: o.order.id,
            order_number: o.order.order_number,
            status: o.order.status,
            service_name_ar: o.service.name_ar,
            city_name_ar: 'الدمام',
            provider_name_ar: o.provider?.business_name_ar ?? null,
            status_age: o.order.status === 'searching' ? '00:08:32' : '00:44:00',
            dispatch_round: o.order.dispatch_round,
            offers_total: o.offers.length,
            offers_open: 0,
            attention:
              o.order.status === 'disputed'
                ? 'disputed'
                : o.order.status === 'searching'
                  ? 'search_stuck'
                  : o.order.status === 'awaiting_approval'
                    ? 'awaiting_customer'
                    : 'none',
          }));

      case 'ops_list_orders': {
        const status = args['p_status'];
        const rows = s.orders
          .filter((o) =>
            status === null || status === undefined
              ? true
              : status === 'open'
                ? !['draft', 'completed', 'cancelled'].includes(o.order.status)
                : o.order.status === status,
          )
          .filter((o) =>
            includes(
              `${o.order.order_number} ${o.customer?.full_name ?? ''} ${o.customer?.phone ?? ''}`,
              args['p_query'],
            ),
          )
          .map(orderRow);
        return page(rows, args);
      }

      case 'ops_order_detail':
        return this.orderFile(args['p_order_id']);

      case 'ops_cancel_order': {
        const reason = reasonOf(args['p_reason']);
        const file = this.orderFile(args['p_order_id']);
        if (['completed', 'cancelled', 'disputed'].includes(file.order.status)) {
          throw new ApiError('A completed order cannot be cancelled', '23514', null);
        }
        this.setOrder(file.order.id, {
          status: 'cancelled',
          cancellation_reason: `هبّة: ${reason}`,
          cancelled_at: new Date().toISOString(),
          escrow_status:
            file.order.escrow_status === 'authorised' ? 'released' : file.order.escrow_status,
        });
        return null;
      }

      case 'ops_confirm_completion': {
        reasonOf(args['p_reason']);
        const file = this.orderFile(args['p_order_id']);
        this.setOrder(file.order.id, {
          status: 'completed',
          escrow_status: 'captured',
          completed_at: new Date().toISOString(),
        });
        return null;
      }

      case 'ops_assign_provider': {
        reasonOf(args['p_reason']);
        const file = this.orderFile(args['p_order_id']);
        const provider = s.providers.find((p) => p.provider.id === args['p_provider_id']);
        if (provider === undefined || provider.provider.verification_status !== 'approved') {
          throw new ApiError('Only an approved provider can be assigned', '23514', null);
        }
        this.setOrder(
          file.order.id,
          { status: 'accepted' },
          {
            provider: {
              id: provider.provider.id,
              business_name_ar: provider.provider.business_name_ar,
              provider_type: provider.provider.provider_type,
              owner_profile_id: provider.owner.id,
              phone: provider.owner.phone,
              verification_status: provider.provider.verification_status,
              rating_avg: provider.provider.rating_avg,
              is_online: provider.provider.is_online,
            },
          },
        );
        return null;
      }

      case 'ops_retry_dispatch':
        return 2;

      case 'ops_issue_invoice': {
        const file = this.orderFile(args['p_order_id']);
        if (file.order.status !== 'completed') {
          throw new ApiError('Only a completed order can be invoiced', '23514', null);
        }
        if (file.invoices.length > 0) {
          throw new ApiError('This order is already invoiced', '23505', null);
        }
        const id = `inv-${file.order.id}`;
        const invoice = {
          id,
          invoice_number: `HB-INV-DEV-${file.order.order_number}`,
          invoice_type: 'simplified',
          total_amount: file.order.total_amount ?? 0,
          issued_at: new Date().toISOString(),
        };
        this.state.orders = this.state.orders.map((candidate) =>
          candidate.order.id === file.order.id ? { ...candidate, invoices: [invoice] } : candidate,
        );
        this.audit('insert', 'zatca_invoices', id, { ...invoice, order_id: file.order.id });
        return id;
      }

      case 'ops_open_dispute': {
        const reason = reasonOf(args['p_reason']);
        const file = this.orderFile(args['p_order_id']);
        this.setOrder(
          file.order.id,
          { status: 'disputed' },
          {
            disputes: [
              ...file.disputes,
              {
                id: `disp-${Date.now()}`,
                order_id: file.order.id,
                reason,
                opened_at: new Date().toISOString(),
                resolution: null,
                refund_amount: null,
                resolution_note: null,
                resolved_at: null,
                payout_already_built: false,
              },
            ],
          },
        );
        return null;
      }

      case 'ops_resolve_dispute': {
        const note = reasonOf(args['p_note']);
        const file = this.orderFile(args['p_order_id']);
        const total = file.order.total_amount ?? 0;
        const resolution = args['p_resolution'] as 'upheld' | 'partial_refund' | 'full_refund';
        const refund =
          resolution === 'full_refund'
            ? total - file.order.refunded_amount
            : resolution === 'partial_refund'
              ? Number(args['p_refund_amount'] ?? 0)
              : 0;
        if (
          resolution === 'partial_refund' &&
          (refund <= 0 || refund >= total - file.order.refunded_amount)
        ) {
          throw new ApiError(
            'A partial refund is more than nothing and less than the amount paid',
            '23514',
            null,
          );
        }
        this.setOrder(
          file.order.id,
          {
            status: 'completed',
            refunded_amount: file.order.refunded_amount + refund,
            escrow_status: resolution === 'full_refund' ? 'refunded' : file.order.escrow_status,
          },
          {
            disputes: file.disputes.map((d) =>
              d.resolved_at === null
                ? {
                    ...d,
                    resolution,
                    refund_amount: refund,
                    resolution_note: note,
                    resolved_at: new Date().toISOString(),
                  }
                : d,
            ),
          },
        );
        if (refund > 0) {
          s.paymentOperations.unshift({
            id: `po-${Date.now()}`,
            order_id: file.order.id,
            kind: 'refund',
            amount: refund,
            status: 'pending',
            reason: note,
            created_at: new Date().toISOString(),
            processed_at: null,
            psp_reference: null,
            last_error: null,
            order_number: file.order.order_number,
            payment_intent_id: file.order.payment_intent_id,
            customer_name: file.customer?.full_name ?? '',
            requested_by_name: 'مشغّل التطوير',
          });
        }
        return null;
      }

      case 'ops_list_disputes': {
        const open = args['p_open'];
        const rows: DisputeRow[] = s.orders.flatMap((o) =>
          o.disputes
            .filter(
              (d) =>
                open === null ||
                open === undefined ||
                (open ? d.resolved_at === null : d.resolved_at !== null),
            )
            .map((d) => ({
              ...d,
              order_number: o.order.order_number,
              service_name_ar: o.service.name_ar,
              customer_name: o.customer?.full_name ?? '',
              provider_name_ar: o.provider?.business_name_ar ?? null,
              total_amount: o.order.total_amount,
              refunded_amount: o.order.refunded_amount,
            })),
        );
        return rows;
      }

      case 'ops_list_users': {
        const filter = String(args['p_filter'] ?? 'all');
        const rows: UserRow[] = s.users
          .filter((u) =>
            includes(
              `${u.profile.full_name} ${u.profile.phone ?? ''} ${u.profile.email ?? ''}`,
              args['p_query'],
            ),
          )
          .filter((u) =>
            filter === 'suspended'
              ? u.suspended
              : filter === 'providers'
                ? u.provider !== null
                : filter === 'staff'
                  ? u.roles.some(
                      (r) => ['ops', 'super_admin'].includes(r.role) && r.revoked_at === null,
                    )
                  : filter === 'customers'
                    ? u.provider === null
                    : true,
          )
          .map((u) => ({
            id: u.profile.id,
            full_name: u.profile.full_name,
            phone: u.profile.phone,
            email: u.profile.email,
            is_guest: u.profile.is_guest,
            roles: u.roles.filter((r) => r.revoked_at === null).map((r) => r.role),
            suspended: u.suspended,
            orders_count: u.orders.length,
            created_at: u.profile.created_at,
            total_count: 0,
          }));
        return page(rows, args);
      }

      case 'ops_user_detail': {
        const user = s.users.find((u) => u.profile.id === args['p_user_id']);
        if (user === undefined) throw new ApiError('User not found', 'P0002', null);
        return user;
      }

      case 'ops_set_suspension': {
        const reason = reasonOf(args['p_reason']);
        const suspend = args['p_suspend'] === true;
        s.users = s.users.map((u) =>
          u.profile.id === args['p_user_id']
            ? {
                ...u,
                suspended: suspend,
                suspensions: suspend
                  ? [
                      {
                        id: `sus-${Date.now()}`,
                        reason,
                        suspended_at: new Date().toISOString(),
                        suspended_by_name: 'مشغّل التطوير',
                        lifted_at: null,
                        lift_note: null,
                      },
                      ...u.suspensions,
                    ]
                  : u.suspensions.map((x) =>
                      x.lifted_at === null
                        ? { ...x, lifted_at: new Date().toISOString(), lift_note: reason }
                        : x,
                    ),
              }
            : u,
        );
        this.audit('insert', 'account_suspensions', String(args['p_user_id']), { reason, suspend });
        return null;
      }

      case 'ops_update_profile':
        s.users = s.users.map((u) =>
          u.profile.id === args['p_user_id']
            ? { ...u, profile: { ...u.profile, full_name: String(args['p_full_name']) } }
            : u,
        );
        return null;

      case 'ops_add_note': {
        const note = {
          id: `note-${Date.now()}`,
          body: String(args['p_body']),
          author_name: 'مشغّل التطوير',
          created_at: new Date().toISOString(),
        };
        const id = args['p_id'];
        s.orders = s.orders.map((o) =>
          o.order.id === id ? { ...o, notes: [note, ...o.notes] } : o,
        );
        s.users = s.users.map((u) =>
          u.profile.id === id ? { ...u, notes: [note, ...u.notes] } : u,
        );
        s.providers = s.providers.map((p) =>
          p.provider.id === id ? { ...p, notes: [note, ...p.notes] } : p,
        );
        s.vehicles = s.vehicles.map((v) =>
          v.vehicle.id === id ? { ...v, notes: [note, ...v.notes] } : v,
        );
        return null;
      }

      case 'ops_list_staff':
        return s.staff;

      case 'ops_set_staff_role':
        throw new ApiError('Only a super admin manages staff roles', '42501', null);

      case 'ops_export_user_data': {
        reasonOf(args['p_reason']);
        const user = s.users.find((u) => u.profile.id === args['p_user_id']);
        return {
          generated_at: new Date().toISOString(),
          profile: user?.profile ?? null,
          vehicles: user?.vehicles ?? [],
          orders: user?.orders ?? [],
        };
      }

      case 'ops_anonymise_user':
        throw new ApiError('Only a super admin may erase an account', '42501', null);

      case 'ops_list_providers': {
        const status = args['p_status'];
        const rows: ProviderRow[] = s.providers
          .filter(
            (p) =>
              status === null || status === undefined || p.provider.verification_status === status,
          )
          .filter((p) => includes(p.provider.business_name_ar, args['p_query']))
          .map((p) => ({
            id: p.provider.id,
            business_name_ar: p.provider.business_name_ar,
            provider_type: p.provider.provider_type,
            verification_status: p.provider.verification_status,
            city_name_ar: p.city?.name_ar ?? null,
            owner_profile_id: p.owner.id,
            owner_phone: p.owner.phone,
            is_online: p.provider.is_online,
            rating_avg: p.provider.rating_avg,
            rating_count: p.provider.rating_count,
            jobs_completed: p.provider.jobs_completed,
            nafath_verified_at: p.provider.nafath_verified_at,
            suspended: p.owner.suspended,
            created_at: p.provider.created_at,
            total_count: 0,
          }));
        return page(rows, args);
      }

      case 'ops_provider_detail': {
        const provider = s.providers.find((p) => p.provider.id === args['p_provider_id']);
        if (provider === undefined) throw new ApiError('Provider not found', 'P0002', null);
        return {
          ...provider,
          payouts: s.payouts.filter((p) => p.provider_id === provider.provider.id),
        };
      }

      case 'set_provider_verification': {
        const status = args['p_status'] as ProviderFile['provider']['verification_status'];
        const note = typeof args['p_note'] === 'string' ? args['p_note'] : null;
        if ((status === 'rejected' || status === 'suspended') && (note ?? '').trim() === '') {
          throw new ApiError('A rejection or suspension needs a stated reason', '23514', null);
        }
        s.providers = s.providers.map((p) =>
          p.provider.id === args['p_provider_id']
            ? {
                ...p,
                provider: {
                  ...p.provider,
                  verification_status: status,
                  is_online: status === 'approved' && p.provider.is_online,
                },
                verification_events: [
                  {
                    from: p.provider.verification_status,
                    to: status,
                    note,
                    actor_name: 'مشغّل التطوير',
                    at: new Date().toISOString(),
                  },
                  ...p.verification_events,
                ],
              }
            : p,
        );
        this.audit('update', 'providers', String(args['p_provider_id']), {
          verification_status: status,
        });
        return null;
      }

      case 'ops_force_offline':
        reasonOf(args['p_reason']);
        s.providers = s.providers.map((p) =>
          p.provider.id === args['p_provider_id']
            ? { ...p, provider: { ...p.provider, is_online: false }, location: null }
            : p,
        );
        return null;

      case 'ops_set_provider_service':
        s.providers = s.providers.map((p) =>
          p.provider.id === args['p_provider_id']
            ? {
                ...p,
                services: p.services.map((svc) =>
                  svc.service_id === args['p_service_id']
                    ? {
                        ...svc,
                        offered: args['p_offered'] === true,
                        custom_price: (args['p_custom_price'] as number | null) ?? null,
                      }
                    : svc,
                ),
              }
            : p,
        );
        return null;

      case 'ops_vehicle_detail': {
        const vehicle = s.vehicles.find((v) => v.vehicle.id === args['p_vehicle_id']);
        if (vehicle === undefined) throw new ApiError('Vehicle not found', 'P0002', null);
        return vehicle;
      }

      case 'ops_annotate_vehicle': {
        const note = reasonOf(args['p_note_ar']);
        s.vehicles = s.vehicles.map((v) =>
          v.vehicle.id === args['p_vehicle_id']
            ? {
                ...v,
                timeline: [
                  {
                    id: `tl-${Date.now()}`,
                    seq: (v.timeline[0]?.seq ?? 0) + 1,
                    event_type: 'record_annotated',
                    occurred_at: new Date().toISOString(),
                    mileage: null,
                    provenance: 'habba_verified',
                    summary_ar: `ملاحظة من هبّة: ${note}`,
                    order_id: null,
                    attachments: 0,
                    row_hash: 'demo…',
                  },
                  ...v.timeline,
                ],
              }
            : v,
        );
        return 'tl-new';
      }

      case 'ops_set_vehicle_active':
        reasonOf(args['p_reason']);
        s.vehicles = s.vehicles.map((v) =>
          v.vehicle.id === args['p_vehicle_id']
            ? { ...v, vehicle: { ...v.vehicle, is_active: args['p_active'] === true } }
            : v,
        );
        return null;

      case 'ops_revoke_report':
        reasonOf(args['p_reason']);
        s.vehicles = s.vehicles.map((v) => ({
          ...v,
          reports: v.reports.map((r) =>
            r.id === args['p_report_id'] ? { ...r, revoked_at: new Date().toISOString() } : r,
          ),
        }));
        return null;

      case 'ops_cancel_transfer':
        reasonOf(args['p_reason']);
        return null;

      case 'ops_list_ratings':
        return args['p_hidden_only'] === true
          ? s.ratings.filter((r) => r.hidden_at !== null)
          : s.ratings;

      case 'ops_set_rating_hidden': {
        const hidden = args['p_hidden'] === true;
        const reason = hidden ? reasonOf(args['p_reason']) : null;
        s.ratings = s.ratings.map((r) =>
          r.id === args['p_rating_id']
            ? { ...r, hidden_at: hidden ? new Date().toISOString() : null, hidden_reason: reason }
            : r,
        );
        return null;
      }

      case 'ops_finance_summary':
        return {
          orders: 96,
          gross: 16_420,
          refunded: 230,
          net_of_vat: 14_278.26,
          vat: 2_141.74,
          held_authorised: 690,
          payouts_pending: 1_995,
          payouts_paid: 11_310,
          commission: 2_855.65,
        };

      case 'ops_list_payment_operations': {
        const status = args['p_status'];
        return s.paymentOperations.filter(
          (p) => status === null || status === undefined || p.status === status,
        );
      }

      case 'ops_record_payment_operation': {
        const status = args['p_status'] as 'succeeded' | 'failed';
        const reference = String(args['p_reference'] ?? '').trim();
        if (status === 'succeeded' && reference === '') {
          throw new ApiError("Record the payment provider's reference", '23514', null);
        }
        s.paymentOperations = s.paymentOperations.map((p) =>
          p.id === args['p_operation_id']
            ? {
                ...p,
                status,
                psp_reference: reference || null,
                processed_at: new Date().toISOString(),
                last_error: (args['p_error'] as string | null) ?? null,
              }
            : p,
        );
        return null;
      }

      case 'ops_list_payouts': {
        const status = args['p_status'];
        return s.payouts.filter(
          (p) => status === null || status === undefined || p.status === status,
        );
      }

      case 'build_payout':
        return 'pay-new';

      case 'ops_set_payout_status': {
        const payout = s.payouts.find((p) => p.id === args['p_payout_id']);
        if (payout?.status === 'paid') throw new ApiError('A paid payout is final', '23514', null);
        const status = args['p_status'] as Payout['status'];
        const reference = typeof args['p_reference'] === 'string' ? args['p_reference'].trim() : '';
        if (status === 'paid' && reference === '')
          throw new ApiError('Record the bank transfer reference', '23514', null);
        s.payouts = s.payouts.map((p) =>
          p.id === args['p_payout_id']
            ? {
                ...p,
                status,
                reference: reference || p.reference,
                paid_at: status === 'paid' ? new Date().toISOString() : null,
              }
            : p,
        );
        return null;
      }

      case 'ops_broadcast': {
        const row = {
          id: `b-${Date.now()}`,
          audience: args['p_audience'],
          title_ar: args['p_title_ar'],
          body_ar: args['p_body_ar'],
          recipients: 1_204,
          sent_by_name: 'مشغّل التطوير',
          created_at: new Date().toISOString(),
        };
        (s.records['broadcasts'] as Row[]).unshift(row);
        return row.recipients;
      }

      case 'ops_list_records':
        return s.records[String(args['p_kind'])] ?? [];
    }
    throw new ApiError(`${fn} is not available in demo mode`, null, null);
  }

  async list<T extends Row>(table: string, options: ListOptions = {}): Promise<T[]> {
    let rows = [...(this.state.tables[table] ?? [])];
    for (const [column, value] of Object.entries(options.eq ?? {})) {
      rows = rows.filter((row) => row[column] === value);
    }
    for (const [column, values] of Object.entries(options.in ?? {})) {
      rows = rows.filter((row) => values.includes(row[column] as string | number));
    }
    if (options.order !== undefined) {
      const key = options.order;
      const direction = options.ascending === false ? -1 : 1;
      rows.sort((a, b) =>
        String(a[key]) < String(b[key])
          ? -direction
          : String(a[key]) > String(b[key])
            ? direction
            : 0,
      );
    }
    if (options.limit !== undefined) rows = rows.slice(0, options.limit);
    return rows as T[];
  }

  async insert(table: string, row: Row): Promise<void> {
    const rows = this.state.tables[table] ?? [];
    const withId =
      'id' in row || table === 'maintenance_item_types'
        ? row
        : { id: `${table}-${Date.now()}`, ...row };
    this.state.tables[table] = [...rows, withId];
    this.audit('insert', table, String(withId['id'] ?? withId['item_type'] ?? ''), withId);
  }

  async update(table: string, match: Row, patch: Row): Promise<void> {
    this.state.tables[table] = (this.state.tables[table] ?? []).map((row) =>
      Object.entries(match).every(([key, value]) => row[key] === value)
        ? { ...row, ...patch }
        : row,
    );
    this.audit('update', table, String(Object.values(match)[0] ?? ''), patch);
  }

  async remove(table: string, match: Row): Promise<void> {
    this.state.tables[table] = (this.state.tables[table] ?? []).filter(
      (row) => !Object.entries(match).every(([key, value]) => row[key] === value),
    );
    this.audit('delete', table, String(Object.values(match)[0] ?? ''), {});
  }
}
