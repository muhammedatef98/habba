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

import { normalisePlate } from '@habba/core';
import { getSupabaseClient } from '../lib/supabase.js';
import { useSession } from '../state/session.js';
import { SupabaseRepository } from './supabase-repository.js';
import type {
  NewVehicleInput,
  Profile,
  TimelineEvent,
  Vehicle,
  VehicleMake,
  VehicleModel,
} from './types.js';

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

  // Phase 2. Note there is still no method that writes a timeline row with a
  // caller-chosen provenance — that remains impossible by construction.
  recordPastService(input: PastServiceInput): Promise<void>;
  recordMileage(vehicleId: string, mileage: number): Promise<void>;
  generateReport(vehicleId: string): Promise<string>;
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
