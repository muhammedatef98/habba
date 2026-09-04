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

import { addSar, applyRate, multiplySar, normalisePlate, sarOrThrow } from '@habba/core';
import { assertProviderApplicationsAllowed } from '@/features/shared/access/provider-access.js';
import { kycVault } from '@/features/shared/lib/kyc.js';
import { getSupabaseClient } from '@/features/shared/lib/supabase.js';
import { useSession } from '@/features/shared/state/session.js';
import { SupabaseRepository } from './supabase-repository.js';
import type {
  City,
  NewEmergencyOrderInput,
  NewRatingInput,
  NewVehicleInput,
  Order,
  OrderPart,
  Profile,
  ProviderApplication,
  ProviderApplicationInput,
  ProviderSummary,
  Service,
  TimelineAttachment,
  TimelineEvent,
  UserRole,
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
  /**
   * Photos and receipts. These are not decoration: an entry with an attachment
   * is `self_documented` rather than `self_reported` (ADR-0005), which is a
   * real difference on the report a buyer reads. The server derives that — the
   * client cannot ask for a trust level.
   */
  readonly attachments?: readonly TimelineAttachment[] | undefined;
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

  /**
   * The roles the SERVER says this user holds (migration 0040).
   *
   * There is deliberately no `setRoles`. A role is granted by approval, never
   * requested (§5.1.3) — and if this ever returned a lie, RLS would still
   * refuse the request: the app's opinion decides only what it renders.
   */
  listRoles(): Promise<readonly UserRole[]>;
  /** This user's own KYC application, if they have ever made one. */
  getProviderApplication(): Promise<ProviderApplication>;
  /**
   * «اشتغل معنا كفنّي» — creates a `pending` provider record (§5.1.1). It
   * grants nothing on its own: the role arrives only when ops approves.
   */
  applyAsProvider(input: ProviderApplicationInput): Promise<ProviderApplication>;
  listCities(): Promise<readonly City[]>;

  // Phase 2. Note there is still no method that writes a timeline row with a
  // caller-chosen provenance — that remains impossible by construction.
  recordPastService(input: PastServiceInput): Promise<void>;
  recordMileage(vehicleId: string, mileage: number): Promise<void>;
  generateReport(vehicleId: string): Promise<string>;

  // Phase 3. Note there is no method that sets `escrowStatus`, `totalAmount`
  // or `providerId` directly — those are guarded server-side (0033) and
  // written only by the matching function and the payment functions, never by
  // a client call.
  listEmergencyServices(): Promise<readonly Service[]>;
  createEmergencyOrder(input: NewEmergencyOrderInput): Promise<string>;
  getOrder(orderId: string): Promise<Order | null>;
  getOrderProvider(providerId: string): Promise<ProviderSummary | null>;
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

// Launch scope (§0): Eastern Province and Riyadh. Mirrors supabase/seed/01.
const CITIES: readonly City[] = [
  { id: 'city-riyadh', nameAr: 'الرياض', nameEn: 'Riyadh' },
  { id: 'city-dammam', nameAr: 'الدمام', nameEn: 'Dammam' },
  { id: 'city-khobar', nameAr: 'الخبر', nameEn: 'Khobar' },
  { id: 'city-dhahran', nameAr: 'الظهران', nameEn: 'Dhahran' },
  { id: 'city-jubail', nameAr: 'الجبيل', nameEn: 'Jubail' },
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
  },
];

const DEV_PROVIDER: ProviderSummary = {
  id: 'provider-dev-1',
  businessNameAr: 'فني الحي — خدمة الطوارئ',
  ratingAvg: 4.7,
  ratingCount: 128,
};

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
  private counter = 0;

  create(input: NewEmergencyOrderInput): string {
    this.counter += 1;
    const id = `order-${this.counter}`;
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
          const vatAmount = applyRate(addSar(partsAmount, labourAmount), '0.15');
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
  private application: ProviderApplication | null = null;
  private applicationType: 'individual' | 'workshop' = 'individual';
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
        details: {},
        attachments: [],
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

    // Mirrors derive_timeline_provenance exactly: with no order attached, an
    // entry is self_documented when the owner attached evidence and
    // self_reported when they did not. The stub must not be more generous than
    // the database, or the UI learns a trust level production will not give it.
    const attachments = input.attachments ?? [];

    events.push({
      id: `evt-${input.vehicleId}-${events.length + 1}`,
      vehicleId: input.vehicleId,
      eventType: 'service_completed',
      occurredAt: input.occurredAt.toISOString(),
      recordedAt: now,
      mileage: input.mileage ?? null,
      provenance: attachments.length > 0 ? 'self_documented' : 'self_reported',
      summaryAr: input.summaryAr,
      summaryEn: input.summaryAr,
      details: input.details ?? {},
      attachments,
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
      details: {},
      attachments: [],
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

  async getOrder(orderId: string) {
    return this.orders.get(orderId);
  }

  async getOrderProvider(providerId: string) {
    return providerId === DEV_PROVIDER.id ? DEV_PROVIDER : null;
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
      details: {},
      attachments: [],
    });
    this.timeline.set(order.vehicleId, events);
  }

  async rateOrder(): Promise<void> {
    // No read surface depends on the dev rating yet — accepting and
    // discarding it is enough to exercise the flow offline.
  }

  // Roles ---------------------------------------------------------------------
  // The stub mirrors the server's rule exactly (§5.1.1): everyone holds
  // `customer` from the moment a profile exists, and the provider role appears
  // only when an application reaches `approved`. A dev stub that handed out the
  // provider role on request would teach the UI a rule production does not have.
  async listRoles(): Promise<readonly UserRole[]> {
    if (this.profile === null) return [];

    const roles: UserRole[] = ['customer'];
    if (this.application?.status === 'approved') {
      roles.push(this.applicationType === 'workshop' ? 'workshop_admin' : 'technician');
    }
    return roles;
  }

  async getProviderApplication(): Promise<ProviderApplication> {
    return this.application ?? { status: 'none', businessNameAr: null, submittedAt: null };
  }

  async applyAsProvider(input: ProviderApplicationInput): Promise<ProviderApplication> {
    // Not only a UI concern: with ENABLE_PROVIDER_MODE off, no national ID or
    // IBAN may be sealed and stored, whatever screen asked (ADR-0017).
    assertProviderApplicationsAllowed();
    if (this.profile === null) throw new Error('not_signed_in');
    if (this.application !== null && this.application.status !== 'rejected') {
      throw new Error('already_applied');
    }

    // Sealed here for the same reason the server refuses plaintext: the value
    // must never exist in storage in a readable form (§11).
    await kycVault.seal(input.nationalId);
    await kycVault.seal(input.iban);

    this.applicationType = input.providerType;
    this.application = {
      // `pending`, never `approved`. Approval is an ops action; a stub that
      // approved instantly would hide every screen that has to handle waiting.
      status: 'pending',
      businessNameAr: input.businessNameAr,
      submittedAt: new Date().toISOString(),
    };
    return this.application;
  }

  async listCities(): Promise<readonly City[]> {
    return CITIES;
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
