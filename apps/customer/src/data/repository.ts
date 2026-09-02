/**
 * Data access behind an interface.
 *
 * There is no Supabase project yet — the region choice is an open decision
 * (ADR-0010) and is expensive to reverse once real vehicles and an immutable
 * timeline exist. Rather than block the entire app on it, screens depend on
 * this interface and the in-memory implementation backs development.
 *
 * `SupabaseRepository` is a thin translation of the same calls; wiring it up
 * is a credentials change, not a screen change.
 *
 * Note what the interface deliberately does NOT expose: any way to insert a
 * timeline row directly. Appends go through `append_vehicle_timeline_event`
 * (ADR-0003), so the client physically cannot construct a forged entry — the
 * shape of this interface reflects the shape of the security model.
 */

import {
  addSar,
  applyRate,
  multiplySar,
  normalisePlate,
  sarOrThrow,
  SAUDI_VAT_RATE,
} from '@habba/core';
import { getSupabaseClient } from '../lib/supabase.js';
import { useSession } from '../state/session.js';
import { SupabaseRepository } from './supabase-repository.js';
import type {
  AppointmentSlot,
  BookingMode,
  BookingProvider,
  DispatchTelemetry,
  JobProgress,
  MaintenanceAlert,
  OrderSummary,
  NewBookingInput,
  NewEmergencyOrderInput,
  NewRatingInput,
  NewVehicleInput,
  Order,
  OrderPart,
  Profile,
  ProviderSummary,
  Service,
  TimelineEvent,
  Vehicle,
  VehicleMake,
  VehicleModel,
} from './types.js';

export interface GuestUpgradeInput {
  readonly fullName: string;
  readonly phone?: string | undefined;
  readonly email?: string | undefined;
}

export interface PastServiceInput {
  readonly vehicleId: string;
  readonly summaryAr: string;
  readonly occurredAt: Date;
  readonly mileage?: number | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface Repository {
  listMakes(): Promise<readonly VehicleMake[]>;
  listModels(makeId: string): Promise<readonly VehicleModel[]>;
  listVehicles(): Promise<readonly Vehicle[]>;
  getVehicle(id: string): Promise<Vehicle | null>;
  addVehicle(input: NewVehicleInput): Promise<Vehicle>;
  listTimeline(vehicleId: string): Promise<readonly TimelineEvent[]>;
  getProfile(): Promise<Profile | null>;
  upsertProfile(profile: Omit<Profile, 'id'>): Promise<Profile>;

  /**
   * Starts a guest session — a real anonymous auth user with a real uid, so
   * RLS works and the logbook is genuinely theirs (migration 0039).
   */
  signInAsGuest(): Promise<Profile>;
  /**
   * Attaches a phone or email to the CURRENT uid. Keeping the uid is the
   * entire point: the guest's vehicles and timeline carry over rather than
   * being stranded on an abandoned account.
   */
  upgradeGuest(input: GuestUpgradeInput): Promise<Profile>;

  // Phase 2. Note there is still no method that writes a timeline row with a
  // caller-chosen provenance — that remains impossible by construction.
  recordPastService(input: PastServiceInput): Promise<void>;
  recordMileage(vehicleId: string, mileage: number): Promise<void>;
  generateReport(vehicleId: string): Promise<string>;

  // Phase 3. Note there is no method that sets `escrowStatus`, `totalAmount`
  // or `providerId` directly — those are guarded server-side (0033) and
  // written only by the matching function and the payment functions, never by
  // a client call.
  /** Open predictive alerts for a vehicle, most urgent first (§1.4). */
  listMaintenanceAlerts(vehicleId: string): Promise<readonly MaintenanceAlert[]>;
  /** The customer's recent orders, newest first. */
  listRecentOrders(limit?: number): Promise<readonly OrderSummary[]>;
  /**
   * Uploads a triage clip against an order and records it on the order.
   *
   * Returns false when there is nowhere to upload to — the dev build has no
   * storage — so the caller can carry on rather than trapping the customer.
   * A clip is an aid to the technician, never a precondition for rescue.
   */
  attachTriageClip(orderId: string, clip: { uri: string; seconds: number }): Promise<boolean>;
  listEmergencyServices(): Promise<readonly Service[]>;
  createEmergencyOrder(input: NewEmergencyOrderInput): Promise<string>;

  // Phase 4 — booking ahead. The server side has existed since 0024; these are
  // the calls the customer app was missing, which is why حجز موعد led to a
  // "coming soon" card while `book_appointment` sat there fully written.
  /** Everything the customer can book ahead — the catalogue minus emergencies. */
  listBookableServices(): Promise<readonly Service[]>;
  /** Approved providers offering this service in this mode, best rated first. */
  listBookingProviders(serviceId: string, mode: BookingMode): Promise<readonly BookingProvider[]>;
  /** A provider's free upcoming windows, earliest first. Never past ones. */
  listSlots(providerId: string): Promise<readonly AppointmentSlot[]>;
  /**
   * Claims a slot and opens the order (0024's `book_appointment`).
   *
   * Throws when the slot filled up between being listed and being tapped —
   * the normal outcome under contention, and the reason the claim is a single
   * atomic UPDATE server-side rather than a read followed by a write.
   */
  bookAppointment(input: NewBookingInput): Promise<string>;
  getOrder(orderId: string): Promise<Order | null>;
  getOrderProvider(providerId: string): Promise<ProviderSummary | null>;
  /**
   * Live figures for an active job — distance, ETA, and the handover code.
   * Returns null whenever the server has nothing to report (no assigned
   * provider, a stale position, or a job that is no longer travelling), which
   * the tracking screens render as their reduced state rather than as zeroes.
   */
  getOrderProgress(orderId: string): Promise<JobProgress | null>;
  /**
   * Live dispatch figures while an order is being matched (§7.1).
   * Null once matching is over — the counts are of no use to the customer
   * afterwards, and they say how many people turned the job down.
   */
  getDispatchTelemetry(orderId: string): Promise<DispatchTelemetry | null>;
  listOrderParts(orderId: string): Promise<readonly OrderPart[]>;
  approveOrderPart(partId: string): Promise<void>;
  cancelOrder(orderId: string, reason?: string): Promise<void>;
  /** Sets status to `completed`, then captures the escrowed payment (§1). */
  confirmOrderCompletion(orderId: string): Promise<void>;
  rateOrder(input: NewRatingInput): Promise<void>;
}

const MAKES: readonly VehicleMake[] = [
  { id: 'make-toyota', nameAr: 'تويوتا', nameEn: 'Toyota' },
  { id: 'make-hyundai', nameAr: 'هيونداي', nameEn: 'Hyundai' },
  { id: 'make-nissan', nameAr: 'نيسان', nameEn: 'Nissan' },
  { id: 'make-kia', nameAr: 'كيا', nameEn: 'Kia' },
  { id: 'make-chevrolet', nameAr: 'شيفروليه', nameEn: 'Chevrolet' },
  { id: 'make-ford', nameAr: 'فورد', nameEn: 'Ford' },
  { id: 'make-gmc', nameAr: 'جي إم سي', nameEn: 'GMC' },
  { id: 'make-lexus', nameAr: 'لكزس', nameEn: 'Lexus' },
];

const MODELS: readonly VehicleModel[] = [
  {
    id: 'm-camry',
    makeId: 'make-toyota',
    nameAr: 'كامري',
    nameEn: 'Camry',
    yearFrom: 2010,
    yearTo: null,
  },
  {
    id: 'm-corolla',
    makeId: 'make-toyota',
    nameAr: 'كورولا',
    nameEn: 'Corolla',
    yearFrom: 2010,
    yearTo: null,
  },
  {
    id: 'm-landcruiser',
    makeId: 'make-toyota',
    nameAr: 'لاند كروزر',
    nameEn: 'Land Cruiser',
    yearFrom: 2010,
    yearTo: null,
  },
  {
    id: 'm-hilux',
    makeId: 'make-toyota',
    nameAr: 'هايلكس',
    nameEn: 'Hilux',
    yearFrom: 2010,
    yearTo: null,
  },
  {
    id: 'm-elantra',
    makeId: 'make-hyundai',
    nameAr: 'النترا',
    nameEn: 'Elantra',
    yearFrom: 2011,
    yearTo: null,
  },
  {
    id: 'm-sonata',
    makeId: 'make-hyundai',
    nameAr: 'سوناتا',
    nameEn: 'Sonata',
    yearFrom: 2011,
    yearTo: null,
  },
  {
    id: 'm-tucson',
    makeId: 'make-hyundai',
    nameAr: 'توسان',
    nameEn: 'Tucson',
    yearFrom: 2011,
    yearTo: null,
  },
  {
    id: 'm-sunny',
    makeId: 'make-nissan',
    nameAr: 'صني',
    nameEn: 'Sunny',
    yearFrom: 2012,
    yearTo: null,
  },
  {
    id: 'm-patrol',
    makeId: 'make-nissan',
    nameAr: 'باترول',
    nameEn: 'Patrol',
    yearFrom: 2010,
    yearTo: null,
  },
  {
    id: 'm-altima',
    makeId: 'make-nissan',
    nameAr: 'ألتيما',
    nameEn: 'Altima',
    yearFrom: 2012,
    yearTo: null,
  },
  {
    id: 'm-cerato',
    makeId: 'make-kia',
    nameAr: 'سيراتو',
    nameEn: 'Cerato',
    yearFrom: 2012,
    yearTo: null,
  },
  {
    id: 'm-sportage',
    makeId: 'make-kia',
    nameAr: 'سبورتاج',
    nameEn: 'Sportage',
    yearFrom: 2012,
    yearTo: null,
  },
  {
    id: 'm-tahoe',
    makeId: 'make-chevrolet',
    nameAr: 'تاهو',
    nameEn: 'Tahoe',
    yearFrom: 2010,
    yearTo: null,
  },
  {
    id: 'm-malibu',
    makeId: 'make-chevrolet',
    nameAr: 'ماليبو',
    nameEn: 'Malibu',
    yearFrom: 2013,
    yearTo: null,
  },
  {
    id: 'm-taurus',
    makeId: 'make-ford',
    nameAr: 'تورس',
    nameEn: 'Taurus',
    yearFrom: 2013,
    yearTo: null,
  },
  {
    id: 'm-explorer',
    makeId: 'make-ford',
    nameAr: 'إكسبلورر',
    nameEn: 'Explorer',
    yearFrom: 2013,
    yearTo: null,
  },
  {
    id: 'm-yukon',
    makeId: 'make-gmc',
    nameAr: 'يوكن',
    nameEn: 'Yukon',
    yearFrom: 2010,
    yearTo: null,
  },
  { id: 'm-lx', makeId: 'make-lexus', nameAr: 'LX', nameEn: 'LX', yearFrom: 2010, yearTo: null },
];

// Mirrors seed/02_services.sql: same names and prices, so the dev flow
// teaches the UI the real catalogue rather than a fictional one.
const EMERGENCY_SERVICES: readonly Service[] = [
  {
    id: 'svc-towing',
    category: 'emergency',
    nameAr: 'ونش/سحب',
    nameEn: 'Towing',
    descriptionAr: null,
    icon: 'truck',
    basePrice: sarOrThrow('150.00'),
    requiresVehicle: true,
    supportedModes: ['mobile_ondemand'],
    estDurationMin: 45,
    requiresLift: false,
  },
  {
    id: 'svc-battery',
    category: 'emergency',
    nameAr: 'بطارية — شحن أو تبديل',
    nameEn: 'Battery jump or replacement',
    descriptionAr: null,
    icon: 'battery',
    basePrice: sarOrThrow('120.00'),
    requiresVehicle: true,
    supportedModes: ['mobile_ondemand'],
    estDurationMin: 45,
    requiresLift: false,
  },
  {
    id: 'svc-tyre',
    category: 'emergency',
    nameAr: 'بنشر وتبديل إطار',
    nameEn: 'Tyre puncture or change',
    descriptionAr: null,
    icon: 'tyre',
    basePrice: sarOrThrow('100.00'),
    requiresVehicle: true,
    supportedModes: ['mobile_ondemand'],
    estDurationMin: 45,
    requiresLift: false,
  },
  {
    id: 'svc-lockout',
    category: 'emergency',
    nameAr: 'فتح أبواب',
    nameEn: 'Lockout assistance',
    descriptionAr: null,
    icon: 'key',
    basePrice: sarOrThrow('130.00'),
    requiresVehicle: false,
    supportedModes: ['mobile_ondemand'],
    estDurationMin: 45,
    requiresLift: false,
  },
  {
    id: 'svc-fuel',
    category: 'emergency',
    nameAr: 'توصيل بنزين',
    nameEn: 'Fuel delivery',
    descriptionAr: null,
    icon: 'fuel',
    basePrice: sarOrThrow('90.00'),
    requiresVehicle: false,
    supportedModes: ['mobile_ondemand'],
    estDurationMin: 45,
    requiresLift: false,
  },
  {
    id: 'svc-overheating',
    category: 'emergency',
    nameAr: 'سخونة رادياتير',
    nameEn: 'Overheating radiator',
    descriptionAr: null,
    icon: 'thermometer',
    basePrice: sarOrThrow('140.00'),
    requiresVehicle: true,
    supportedModes: ['mobile_ondemand'],
    estDurationMin: 45,
    requiresLift: false,
  },
];

/**
 * What can be booked ahead — the catalogue minus emergencies.
 *
 * `supportedModes` is the load-bearing field: تغيير زيت can be done in a
 * driveway or a workshop, a brake job needs a lift and so is workshop-only,
 * and a pre-purchase inspection is the one service with
 * `requiresVehicle: false` because the whole point is that the car is not
 * yours yet (§7 — the inspection is how the buyer becomes a customer).
 */
const BOOKABLE_SERVICES: readonly Service[] = [
  {
    id: 'svc-oil',
    category: 'periodic',
    nameAr: 'تغيير زيت وفلتر',
    nameEn: 'Oil and filter change',
    descriptionAr: 'زيت وفلتر أصلي، مع تسجيل القراءة في دفتر السيارة',
    icon: 'oil',
    basePrice: sarOrThrow('220.00'),
    requiresVehicle: true,
    supportedModes: ['mobile_scheduled', 'workshop'],
    estDurationMin: 45,
    requiresLift: false,
  },
  {
    id: 'svc-brakes',
    category: 'periodic',
    nameAr: 'فحص وتغيير فحمات الفرامل',
    nameEn: 'Brake pad inspection and change',
    descriptionAr: 'يحتاج رافعة — في الورشة فقط',
    icon: 'brake',
    basePrice: sarOrThrow('380.00'),
    requiresVehicle: true,
    supportedModes: ['workshop'],
    estDurationMin: 90,
    requiresLift: true,
  },
  {
    id: 'svc-ac',
    category: 'periodic',
    nameAr: 'صيانة مكيّف',
    nameEn: 'Air-conditioning service',
    descriptionAr: 'فحص الضغط وتعبئة الفريون',
    icon: 'snowflake',
    basePrice: sarOrThrow('260.00'),
    requiresVehicle: true,
    supportedModes: ['mobile_scheduled', 'workshop'],
    estDurationMin: 60,
    requiresLift: false,
  },
  {
    id: 'svc-inspection',
    category: 'inspection',
    nameAr: 'فحص ما قبل الشراء',
    nameEn: 'Pre-purchase inspection',
    descriptionAr: 'تقرير مفصّل قبل ما تشتري — ١٢٠ نقطة فحص',
    icon: 'inspection',
    basePrice: sarOrThrow('450.00'),
    // §7.3: the car being inspected is not the customer's yet. This is the one
    // service where demanding a vehicle from the logbook would block the exact
    // customer the inspection exists to win.
    requiresVehicle: false,
    supportedModes: ['mobile_scheduled', 'workshop'],
    estDurationMin: 120,
    requiresLift: false,
  },
  {
    id: 'svc-wash',
    category: 'wash',
    nameAr: 'غسيل وتلميع',
    nameEn: 'Wash and polish',
    descriptionAr: null,
    icon: 'wash',
    basePrice: sarOrThrow('120.00'),
    requiresVehicle: true,
    supportedModes: ['mobile_scheduled'],
    estDurationMin: 60,
    requiresLift: false,
  },
];

/**
 * Providers the booking flow can pick between.
 *
 * Two workshops and two mobile technicians, because the mode picker is
 * meaningless if one side of it is empty — and a flow that offers a choice and
 * then has nothing behind it is worse than not offering it.
 */
interface DevProvider extends BookingProvider {
  readonly serviceIds: readonly string[];
  readonly modes: readonly BookingMode[];
}

const DEV_PROVIDERS: readonly DevProvider[] = [
  {
    id: 'prov-alkhobar-1',
    providerType: 'workshop',
    businessNameAr: 'ورشة الخبر المركزية',
    ratingAvg: 4.8,
    ratingCount: 412,
    jobsCompleted: 1830,
    addressAr: 'الخبر — شارع الملك فهد، مقابل مركز الراشد',
    price: sarOrThrow('0.00'),
    serviceIds: ['svc-oil', 'svc-brakes', 'svc-ac', 'svc-inspection'],
    modes: ['workshop'],
  },
  {
    id: 'prov-dammam-1',
    providerType: 'workshop',
    businessNameAr: 'مركز الدمام لصيانة السيارات',
    ratingAvg: 4.5,
    ratingCount: 267,
    jobsCompleted: 990,
    addressAr: 'الدمام — طريق الأمير محمد بن فهد، حي الشاطئ',
    price: sarOrThrow('0.00'),
    serviceIds: ['svc-oil', 'svc-brakes', 'svc-ac'],
    modes: ['workshop'],
  },
  {
    id: 'prov-mobile-1',
    providerType: 'individual',
    businessNameAr: 'عبدالله — فنّي متنقّل',
    ratingAvg: 4.9,
    ratingCount: 143,
    jobsCompleted: 620,
    addressAr: null,
    price: sarOrThrow('0.00'),
    serviceIds: ['svc-oil', 'svc-ac', 'svc-wash', 'svc-inspection'],
    modes: ['mobile_scheduled'],
  },
  {
    id: 'prov-mobile-2',
    providerType: 'individual',
    businessNameAr: 'ورشة متنقّلة — الشرقية',
    ratingAvg: 4.3,
    ratingCount: 88,
    jobsCompleted: 310,
    addressAr: null,
    price: sarOrThrow('0.00'),
    serviceIds: ['svc-oil', 'svc-wash'],
    modes: ['mobile_scheduled'],
  },
];

/** Working hours the dev slot generator fills, local time. */
const SLOT_HOURS: readonly number[] = [9, 11, 13, 16, 18, 20];
const SLOT_DAYS_AHEAD = 7;

/**
 * Windows for the next week, generated rather than hardcoded so the picker is
 * never looking at a past date — a fixture with literal timestamps rots within
 * days and then the whole flow looks broken.
 *
 * Deterministic per provider: the same provider always has the same gaps, so a
 * fully-booked slot is reproducible instead of flickering between renders.
 */
function devSlotsFor(providerId: string, now: Date): readonly AppointmentSlot[] {
  const slots: AppointmentSlot[] = [];
  const seed = [...providerId].reduce((total, char) => total + char.charCodeAt(0), 0);

  for (let day = 0; day < SLOT_DAYS_AHEAD; day += 1) {
    for (const [index, hour] of SLOT_HOURS.entries()) {
      const startsAt = new Date(now);
      startsAt.setDate(startsAt.getDate() + day);
      startsAt.setHours(hour, 0, 0, 0);

      // Already gone. The server clause is `starts_at > now()`; mirroring it
      // here keeps the dev list honest about what could actually be claimed.
      if (startsAt.getTime() <= now.getTime()) continue;

      const capacity = 2;
      const booked = (seed + day * SLOT_HOURS.length + index) % 5 === 0 ? capacity : 0;
      if (booked >= capacity) continue;

      const endsAt = new Date(startsAt);
      endsAt.setHours(endsAt.getHours() + 1);

      slots.push({
        id: `slot-${providerId}-${day}-${hour}`,
        providerId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        remaining: capacity - booked,
      });
    }
  }

  return slots;
}

const DEV_PROVIDER: ProviderSummary = {
  id: 'provider-dev-1',
  businessNameAr: 'فني الحي — خدمة الطوارئ',
  ratingAvg: 4.7,
  ratingCount: 128,
};

/** The Arabic name of any catalogue entry, emergency or bookable. */
function serviceNameFor(serviceId: string): string {
  const match = [...EMERGENCY_SERVICES, ...BOOKABLE_SERVICES].find(
    (candidate) => candidate.id === serviceId,
  );
  return match?.nameAr ?? serviceId;
}

/**
 * Development order state machine.
 *
 * A deliberately small slice of `enforce_order_transition`: enough for the
 * emergency flow to be exercisable end to end offline. It advances itself on
 * a timer to imitate a provider accepting and working the job, since there is
 * no second device in dev — the point is to let the tracking screen, quote
 * approval and completion confirmation all be built and clicked through
 * before a real Supabase project exists.
 */
class DevOrderSimulator {
  private readonly orders = new Map<string, Order>();
  private readonly parts = new Map<string, OrderPart[]>();
  private readonly createdAt = new Map<string, string>();
  private counter = 0;

  create(input: NewEmergencyOrderInput): string {
    this.counter += 1;
    const id = `order-${this.counter}`;
    this.createdAt.set(id, new Date().toISOString());
    const service = EMERGENCY_SERVICES.find((candidate) => candidate.id === input.serviceId);

    const order: Order = {
      id,
      status: 'searching',
      fulfilmentMode: 'mobile_ondemand',
      vehicleId: input.vehicleId ?? null,
      serviceId: input.serviceId,
      providerId: null,
      serviceAddressAr: input.addressAr ?? null,
      problemDescription: input.problem ?? null,
      quotedAmount: service?.basePrice ?? null,
      partsAmount: null,
      labourAmount: null,
      vatAmount: null,
      totalAmount: null,
      escrowStatus: 'authorised',
      // The dev simulator has no technician taking photographs.
      completionMedia: [],
    };
    this.orders.set(id, order);

    // Advances through the same statuses a real dispatch would, so the
    // tracking screen has something to show without a second device.
    this.advanceAfter(id, 2500, (current) => ({
      ...current,
      status: 'accepted',
      providerId: DEV_PROVIDER.id,
    }));
    this.advanceAfter(id, 5000, (current) => ({ ...current, status: 'en_route' }));
    this.advanceAfter(id, 8000, (current) => ({ ...current, status: 'arrived' }));
    this.advanceAfter(id, 10500, (current) => {
      // A parts quote appears mid-job, same as a technician diagnosing at the
      // roadside — this is what the quote-approval screen has to react to.
      this.parts.set(id, [
        {
          id: `${id}-part-1`,
          orderId: id,
          nameAr: 'بطارية ٧٠ أمبير',
          partNumber: 'BAT-70A',
          isOem: false,
          quantity: 1,
          unitPrice: sarOrThrow('320.00'),
          warrantyDays: 180,
          approvedByCustomer: false,
        },
      ]);
      return { ...current, status: 'in_progress' };
    });

    return id;
  }

  /**
   * A booked appointment, which is a different animal from an emergency: the
   * provider is known at creation because the customer chose them, so the
   * order opens at `accepted` and never passes through `searching`. Nothing
   * advances on a timer either — the job is days away, and a dev simulator
   * that marched a Tuesday appointment to `completed` in ten seconds would
   * teach the UI a lie.
   */
  book(input: NewBookingInput, mode: BookingMode, providerId: string): string {
    this.counter += 1;
    const id = `order-${this.counter}`;
    this.createdAt.set(id, new Date().toISOString());
    const service = BOOKABLE_SERVICES.find((candidate) => candidate.id === input.serviceId);

    this.orders.set(id, {
      id,
      status: 'accepted',
      fulfilmentMode: mode,
      vehicleId: input.vehicleId ?? null,
      serviceId: input.serviceId,
      providerId,
      serviceAddressAr: input.addressAr ?? null,
      problemDescription: input.problem ?? null,
      quotedAmount: service?.basePrice ?? null,
      partsAmount: null,
      labourAmount: null,
      vatAmount: null,
      totalAmount: null,
      escrowStatus: 'authorised',
      completionMedia: [],
    });

    return id;
  }

  private advanceAfter(id: string, delayMs: number, update: (order: Order) => Order) {
    setTimeout(() => {
      const current = this.orders.get(id);
      if (current === undefined || current.status === 'cancelled') return;
      this.orders.set(id, update(current));
    }, delayMs);
  }

  get(id: string): Order | null {
    return this.orders.get(id) ?? null;
  }

  listParts(id: string): readonly OrderPart[] {
    return this.parts.get(id) ?? [];
  }

  approvePart(partId: string): void {
    for (const [orderId, lines] of this.parts) {
      const index = lines.findIndex((line) => line.id === partId);
      if (index === -1) continue;

      const approved = lines.map((line, i) =>
        i === index ? { ...line, approvedByCustomer: true } : line,
      );
      this.parts.set(orderId, approved);

      if (approved.every((line) => line.approvedByCustomer)) {
        const order = this.orders.get(orderId);
        if (order !== undefined) {
          const partsAmount = approved.reduce(
            (sum, line) => addSar(sum, multiplySar(line.unitPrice, line.quantity)),
            sarOrThrow('0.00'),
          );
          const labourAmount = order.quotedAmount ?? sarOrThrow('0.00');
          const vatAmount = applyRate(addSar(partsAmount, labourAmount), SAUDI_VAT_RATE);
          const totalAmount = addSar(addSar(partsAmount, labourAmount), vatAmount);
          this.orders.set(orderId, {
            ...order,
            status: 'awaiting_approval',
            partsAmount,
            labourAmount,
            vatAmount,
            totalAmount,
          });
        }
      }
      return;
    }
  }

  /** Newest first. Mirrors the ordering the server read will use. */
  recent(limit: number): readonly OrderSummary[] {
    return [...this.orders.values()]
      .reverse()
      .slice(0, limit)
      .map((order) => ({
        id: order.id,
        status: order.status,
        // Both halves of the catalogue: a booked oil change would otherwise
        // show its raw id in the history, which is what the emergency-only
        // lookup did the moment booking started creating orders.
        serviceNameAr: serviceNameFor(order.serviceId),
        totalAmount: order.totalAmount,
        createdAt: this.createdAt.get(order.id) ?? new Date().toISOString(),
      }));
  }

  cancel(id: string): void {
    const order = this.orders.get(id);
    if (order === undefined) return;
    this.orders.set(id, { ...order, status: 'cancelled' });
  }

  confirmCompletion(id: string): void {
    const order = this.orders.get(id);
    if (order === undefined) return;
    if (order.status !== 'awaiting_approval') throw new Error('not_awaiting_approval');
    this.orders.set(id, { ...order, status: 'completed', escrowStatus: 'captured' });
  }
}

/**
 * Development repository.
 *
 * It mirrors the database's behaviour where that behaviour is load-bearing:
 * plates are normalised through the same @habba/core function the server uses,
 * and registering a vehicle writes a `vehicle_registered` timeline event with
 * `habba_verified` provenance — exactly what
 * `derive_timeline_provenance` does. A stub that behaves differently from
 * production teaches the UI the wrong lessons.
 */
export class InMemoryRepository implements Repository {
  private readonly vehicles = new Map<string, Vehicle>();
  private readonly timeline = new Map<string, TimelineEvent[]>();
  private readonly orders = new DevOrderSimulator();
  private profile: Profile | null = null;
  private counter = 0;

  async listMakes() {
    return MAKES;
  }

  async listModels(makeId: string) {
    return MODELS.filter((model) => model.makeId === makeId);
  }

  async listVehicles() {
    return [...this.vehicles.values()];
  }

  async getVehicle(id: string) {
    return this.vehicles.get(id) ?? null;
  }

  async addVehicle(input: NewVehicleInput): Promise<Vehicle> {
    this.counter += 1;
    const id = `veh-${this.counter}`;

    const plateNormalised =
      input.plate !== undefined && input.plate.length > 0 ? normalisePlate(input.plate) : null;

    const vehicle: Vehicle = {
      id,
      ownerId: this.profile?.id ?? 'dev-user',
      makeId: input.makeId,
      modelId: input.modelId,
      year: input.year,
      plateEn: plateNormalised,
      plateAr: input.plate ?? null,
      plateNormalised,
      vin: null,
      nickname: input.nickname ?? null,
      currentMileage: input.currentMileage ?? 0,
    };

    this.vehicles.set(id, vehicle);

    const now = new Date().toISOString();
    this.timeline.set(id, [
      {
        id: `evt-${id}-1`,
        vehicleId: id,
        eventType: 'vehicle_registered',
        occurredAt: now,
        recordedAt: now,
        mileage: input.currentMileage ?? null,
        // Matches derive_timeline_provenance: a system fact, not an owner claim.
        provenance: 'habba_verified',
        summaryAr: 'تم تسجيل السيارة في هبّة',
        summaryEn: 'Vehicle registered with Habba',
      },
    ]);

    return vehicle;
  }

  async listTimeline(vehicleId: string) {
    return this.timeline.get(vehicleId) ?? [];
  }

  async getProfile() {
    return this.profile;
  }

  async upsertProfile(profile: Omit<Profile, 'id'>): Promise<Profile> {
    this.profile = { id: this.profile?.id ?? 'dev-user', ...profile };
    return this.profile;
  }

  async signInAsGuest(): Promise<Profile> {
    // Mirrors what Supabase anonymous auth does: a real, distinct uid. The
    // vehicles map is keyed on nothing else, so a guest's cars are genuinely
    // their own — the stub must not pretend guests share an account.
    this.profile = {
      id: this.profile?.id ?? `guest-${Date.now()}`,
      fullName: 'ضيف',
      phone: null,
      email: null,
      isGuest: true,
      preferredLocale: 'ar',
    };
    return this.profile;
  }

  async upgradeGuest(input: GuestUpgradeInput): Promise<Profile> {
    if (this.profile === null) throw new Error('not_signed_in');
    if (input.phone === undefined && input.email === undefined) {
      // Same refusal the database gives (profiles_has_identity, 0039).
      throw new Error('no_identity');
    }

    // The id is carried over unchanged — that is what keeps the logbook.
    this.profile = {
      ...this.profile,
      fullName: input.fullName,
      phone: input.phone ?? this.profile.phone,
      email: input.email ?? this.profile.email,
      isGuest: false,
    };
    return this.profile;
  }

  async recordPastService(input: PastServiceInput): Promise<void> {
    if (input.occurredAt.getTime() > Date.now()) {
      throw new Error('future_date');
    }

    const events = this.timeline.get(input.vehicleId) ?? [];
    const now = new Date().toISOString();

    // Mirrors derive_timeline_provenance: no order, no attachments here, so
    // always self_reported. The stub must not be more generous than the
    // database or the UI learns the wrong lesson.
    events.push({
      id: `evt-${input.vehicleId}-${events.length + 1}`,
      vehicleId: input.vehicleId,
      eventType: 'service_completed',
      occurredAt: input.occurredAt.toISOString(),
      recordedAt: now,
      mileage: input.mileage ?? null,
      provenance: 'self_reported',
      summaryAr: input.summaryAr,
      summaryEn: input.summaryAr,
    });

    this.timeline.set(input.vehicleId, events);
    this.bumpMileage(input.vehicleId, input.mileage);
  }

  async recordMileage(vehicleId: string, mileage: number): Promise<void> {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle === undefined) throw new Error('not_found');
    if (mileage < vehicle.currentMileage) throw new Error('mileage_too_low');

    const events = this.timeline.get(vehicleId) ?? [];
    const now = new Date().toISOString();

    events.push({
      id: `evt-${vehicleId}-${events.length + 1}`,
      vehicleId,
      eventType: 'mileage_recorded',
      occurredAt: now,
      recordedAt: now,
      mileage,
      provenance: 'self_reported',
      summaryAr: `قراءة العداد: ${mileage} كم`,
      summaryEn: `Mileage reading: ${mileage} km`,
    });

    this.timeline.set(vehicleId, events);
    this.bumpMileage(vehicleId, mileage);
  }

  async generateReport(vehicleId: string): Promise<string> {
    // The dev stub cannot verify a hash chain — it has none. It returns a
    // placeholder token so the share flow is exercisable offline; the real
    // refusal-on-broken-chain behaviour lives in the database.
    if (!this.vehicles.has(vehicleId)) throw new Error('not_found');
    return `dev-report-${vehicleId}`;
  }

  async listEmergencyServices() {
    return EMERGENCY_SERVICES;
  }

  async createEmergencyOrder(input: NewEmergencyOrderInput): Promise<string> {
    return this.orders.create(input);
  }

  async listBookableServices(): Promise<readonly Service[]> {
    return BOOKABLE_SERVICES;
  }

  async listBookingProviders(
    serviceId: string,
    mode: BookingMode,
  ): Promise<readonly BookingProvider[]> {
    const service = BOOKABLE_SERVICES.find((candidate) => candidate.id === serviceId);

    return DEV_PROVIDERS.filter(
      (provider) => provider.modes.includes(mode) && provider.serviceIds.includes(serviceId),
    )
      .map(({ serviceIds: _serviceIds, modes: _modes, ...provider }) => ({
        ...provider,
        // The catalogue price stands in until a provider sets their own. The
        // fixtures carry 0.00 rather than a duplicated number so a price
        // change in the catalogue cannot leave the picker quoting a stale one.
        price: service?.basePrice ?? provider.price,
      }))
      .sort((a, b) => b.ratingAvg - a.ratingAvg);
  }

  async listSlots(providerId: string): Promise<readonly AppointmentSlot[]> {
    return devSlotsFor(providerId, new Date());
  }

  async bookAppointment(input: NewBookingInput): Promise<string> {
    const slot = input.slotId;
    const provider = DEV_PROVIDERS.find((candidate) => slot.startsWith(`slot-${candidate.id}-`));
    if (provider === undefined) throw new Error('slot_unavailable');

    // Re-derived rather than trusted from the client: which mode an order is
    // placed in follows from who is fulfilling it, and 0024 decides the same
    // way server-side from the slot's provider.
    const mode: BookingMode =
      provider.providerType === 'workshop' ? 'workshop' : 'mobile_scheduled';

    return this.orders.book(input, mode, provider.id);
  }

  async getOrder(orderId: string) {
    return this.orders.get(orderId);
  }

  async getOrderProvider(providerId: string) {
    return providerId === DEV_PROVIDER.id ? DEV_PROVIDER : null;
  }

  // Seeded rather than empty: the alert card is the moat's most visible claim
  // (§1.4), and a home screen that never shows one teaches the wrong thing
  // about what the product is for. These mirror the shape the rules engine
  // produces server-side, not invented figures for a live order.
  async listMaintenanceAlerts(vehicleId: string): Promise<readonly MaintenanceAlert[]> {
    if (this.vehicles.get(vehicleId) === undefined) return [];
    return [
      {
        id: `alert-${vehicleId}-oil`,
        vehicleId,
        serviceId: 'svc-oil',
        messageAr: 'تبديل الزيت خلال 600 كم',
        messageEn: 'Oil change due within 600 km',
        dueAtKm: 62400,
        estimatedKm: 61800,
        confidence: 'estimated',
      },
    ];
  }

  async listRecentOrders(limit = 5): Promise<readonly OrderSummary[]> {
    return this.orders.recent(limit);
  }

  // No storage in the in-memory build, and saying so is the point: a silent
  // success here would hide that the clip went nowhere.
  async attachTriageClip(): Promise<boolean> {
    return false;
  }

  // The dev build has no matcher and no providers to offer anything to, so
  // there is genuinely nothing to report. Null, not zeroes: "0 contacted"
  // would be a claim, and a false one.
  async getDispatchTelemetry(): Promise<DispatchTelemetry | null> {
    return null;
  }

  // The in-memory repository has no PostGIS and no provider moving around, so
  // there is genuinely nothing to report. Returning null rather than sample
  // figures keeps the dev build honest about which parts are wired: a
  // plausible ETA here would hide the fact that the real one is not yet read.
  async getOrderProgress(_orderId: string): Promise<JobProgress | null> {
    return null;
  }

  async listOrderParts(orderId: string) {
    return this.orders.listParts(orderId);
  }

  async approveOrderPart(partId: string): Promise<void> {
    this.orders.approvePart(partId);
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.orders.cancel(orderId);
  }

  async confirmOrderCompletion(orderId: string): Promise<void> {
    this.orders.confirmCompletion(orderId);

    // Phase 3's acceptance criterion (build prompt §10): a completed job
    // appears in the logbook automatically. The real write goes through
    // `append_vehicle_timeline_event` server-side; the stub mirrors the
    // outcome so the logbook screen has something to show.
    const order = this.orders.get(orderId);
    if (order?.vehicleId === null || order?.vehicleId === undefined) return;

    const events = this.timeline.get(order.vehicleId) ?? [];
    const now = new Date().toISOString();
    events.push({
      id: `evt-${order.vehicleId}-${events.length + 1}`,
      vehicleId: order.vehicleId,
      eventType: 'service_completed',
      occurredAt: now,
      recordedAt: now,
      mileage: null,
      provenance: 'habba_verified',
      summaryAr: 'صيانة طارئة عبر هبّة',
      summaryEn: 'Emergency service via Habba',
    });
    this.timeline.set(order.vehicleId, events);
  }

  async rateOrder(): Promise<void> {
    // No read surface depends on the dev rating yet — accepting and
    // discarding it is enough to exercise the flow offline.
  }

  private bumpMileage(vehicleId: string, mileage: number | undefined): void {
    if (mileage === undefined) return;
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle === undefined) return;

    this.vehicles.set(vehicleId, {
      ...vehicle,
      currentMileage: Math.max(vehicle.currentMileage, mileage),
    });
  }
}

/**
 * The repository the app uses.
 *
 * Supabase when the app has been pointed at a project, in-memory otherwise.
 * The switch is configuration, not a code change — see ADR-0010 for why no
 * project exists yet.
 */
function createRepository(): Repository {
  const client = getSupabaseClient();
  if (client === null) return new InMemoryRepository();
  return new SupabaseRepository(client, () => useSession.getState().userId);
}

export const repository: Repository = createRepository();
