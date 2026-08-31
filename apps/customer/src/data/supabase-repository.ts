/**
 * Supabase-backed repository — the production implementation.
 *
 * Every read relies on RLS rather than filtering by owner in the query: the
 * server decides what this user can see (CLAUDE.md §2.2). A `.eq('owner_id',
 * userId)` filter here would look equivalent and would quietly become the only
 * thing standing between users if a policy were ever dropped.
 *
 * Timeline writes go through the `append_vehicle_timeline_event` RPC. There is
 * deliberately no insert path — direct INSERT is revoked at the grant level
 * (ADR-0003), so a forged entry is not constructible from a client even with a
 * stolen token.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sarOrThrow, type SarAmount } from '@habba/core';
import type {
  AlertConfidence,
  OrderStatus,
  CompletionMedia,
  EscrowStatus,
  JobProgress,
  MaintenanceAlert,
  OrderSummary,
  NewEmergencyOrderInput,
  NewRatingInput,
  NewVehicleInput,
  Order,
  OrderPart,
  Profile,
  ProviderSummary,
  Service,
  ServiceCategory,
  TimelineEvent,
  Vehicle,
  VehicleMake,
  VehicleModel,
} from './types.js';
import type { GuestUpgradeInput, PastServiceInput, Repository } from './repository.js';

interface MaintenanceAlertRow {
  readonly id: string;
  readonly vehicle_id: string;
  readonly service_id: string;
  readonly message_ar: string;
  readonly message_en: string;
  readonly due_at_km: number | null;
  readonly estimated_km: number | null;
  readonly confidence: AlertConfidence;
}

interface OrderSummaryRow {
  readonly id: string;
  readonly status: OrderStatus;
  readonly total_amount: number | null;
  readonly created_at: string;
  // PostgREST returns an embedded resource as an array even when the foreign
  // key makes it one-to-one, and supabase-js types it that way. Narrowed at
  // the boundary rather than pretending the join is scalar.
  readonly services: readonly { readonly name_ar: string }[] | null;
}

/** Shape of one `order_live_progress` row (migration 0040). */
interface LiveProgressRow {
  readonly distance_m: number;
  readonly eta_minutes: number;
  readonly measured_at: string;
}

interface VehicleRow {
  id: string;
  owner_id: string;
  make_id: string;
  model_id: string;
  year: number;
  plate_en: string | null;
  plate_ar: string | null;
  plate_normalised: string | null;
  vin: string | null;
  nickname: string | null;
  current_mileage: number;
}

interface ProfileRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_guest: boolean;
  preferred_locale: 'ar' | 'en';
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    isGuest: row.is_guest,
    preferredLocale: row.preferred_locale,
  };
}

interface TimelineRow {
  id: string;
  vehicle_id: string;
  event_type: TimelineEvent['eventType'];
  occurred_at: string;
  recorded_at: string;
  mileage: number | null;
  provenance: TimelineEvent['provenance'];
  summary_ar: string;
  summary_en: string;
}

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    ownerId: row.owner_id,
    makeId: row.make_id,
    modelId: row.model_id,
    year: row.year,
    plateEn: row.plate_en,
    plateAr: row.plate_ar,
    plateNormalised: row.plate_normalised,
    vin: row.vin,
    nickname: row.nickname,
    currentMileage: row.current_mileage,
  };
}

interface ServiceRow {
  id: string;
  category: ServiceCategory;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  icon: string | null;
  base_price: number;
  requires_vehicle: boolean;
}

interface OrderRow {
  id: string;
  status: Order['status'];
  fulfilment_mode: Order['fulfilmentMode'];
  vehicle_id: string | null;
  service_id: string;
  provider_id: string | null;
  service_address_ar: string | null;
  problem_description: string | null;
  quoted_amount: number | null;
  parts_amount: number | null;
  labour_amount: number | null;
  vat_amount: number | null;
  total_amount: number | null;
  escrow_status: EscrowStatus;
  readonly completion_media: readonly CompletionMedia[] | null;
}

interface OrderPartRow {
  id: string;
  order_id: string;
  name_ar: string;
  part_number: string | null;
  is_oem: boolean;
  quantity: number;
  unit_price: number;
  warranty_days: number | null;
  approved_by_customer: boolean;
}

// PostgREST serialises `numeric` as a JSON number, so it arrives here as a
// plain `number` — exactly the representation CLAUDE.md §2.5 says not to do
// arithmetic on. These convert it straight into the branded, exact
// `SarAmount` (ADR-0007) before it touches any screen.
function toSar(value: number): SarAmount {
  return sarOrThrow(value.toFixed(2));
}

function toSarOrNull(value: number | null): SarAmount | null {
  return value === null ? null : toSar(value);
}

function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    category: row.category,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    descriptionAr: row.description_ar,
    icon: row.icon,
    basePrice: toSar(row.base_price),
    requiresVehicle: row.requires_vehicle,
  };
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    status: row.status,
    fulfilmentMode: row.fulfilment_mode,
    vehicleId: row.vehicle_id,
    serviceId: row.service_id,
    providerId: row.provider_id,
    serviceAddressAr: row.service_address_ar,
    problemDescription: row.problem_description,
    quotedAmount: toSarOrNull(row.quoted_amount),
    partsAmount: toSarOrNull(row.parts_amount),
    labourAmount: toSarOrNull(row.labour_amount),
    vatAmount: toSarOrNull(row.vat_amount),
    totalAmount: toSarOrNull(row.total_amount),
    escrowStatus: row.escrow_status,
    // jsonb defaults to '[]' server-side, but a client that selected an older
    // column list would see undefined — normalise rather than let a screen
    // map over nothing.
    completionMedia: row.completion_media ?? [],
  };
}

function toOrderPart(row: OrderPartRow): OrderPart {
  return {
    id: row.id,
    orderId: row.order_id,
    nameAr: row.name_ar,
    partNumber: row.part_number,
    isOem: row.is_oem,
    quantity: row.quantity,
    unitPrice: toSar(row.unit_price),
    warrantyDays: row.warranty_days,
    approvedByCustomer: row.approved_by_customer,
  };
}

function toTimelineEvent(row: TimelineRow): TimelineEvent {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    mileage: row.mileage,
    provenance: row.provenance,
    summaryAr: row.summary_ar,
    summaryEn: row.summary_en,
  };
}

/**
 * Errors are thrown, never swallowed (CLAUDE.md — no silent failures).
 *
 * Returns `NonNullable<T>` rather than `T`: supabase-js types `data` as
 * `T | null`, and inference otherwise carries the null into T, so callers end
 * up re-checking something this function has already guaranteed.
 */
function unwrap<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string,
): NonNullable<T> {
  if (result.error !== null) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  if (result.data === null || result.data === undefined) {
    throw new Error(`${context}: no data returned`);
  }
  return result.data as NonNullable<T>;
}

export class SupabaseRepository implements Repository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: () => string | null,
  ) {}

  async listMakes(): Promise<readonly VehicleMake[]> {
    const rows = unwrap(
      await this.client
        .from('vehicle_makes')
        .select('id, name_ar, name_en')
        .eq('is_active', true)
        .order('sort_order'),
      'listMakes',
    );

    return rows.map((row) => ({ id: row.id, nameAr: row.name_ar, nameEn: row.name_en }));
  }

  async listModels(makeId: string): Promise<readonly VehicleModel[]> {
    const rows = unwrap(
      await this.client
        .from('vehicle_models')
        .select('id, make_id, name_ar, name_en, year_from, year_to')
        .eq('make_id', makeId)
        .eq('is_active', true)
        .order('name_en'),
      'listModels',
    );

    return rows.map((row) => ({
      id: row.id,
      makeId: row.make_id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      yearFrom: row.year_from,
      yearTo: row.year_to,
    }));
  }

  async listVehicles(): Promise<readonly Vehicle[]> {
    // No owner filter: RLS decides. See the note at the top of this file.
    const rows = unwrap(
      await this.client
        .from('vehicles')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
      'listVehicles',
    );

    return (rows as VehicleRow[]).map(toVehicle);
  }

  async getVehicle(id: string): Promise<Vehicle | null> {
    const { data, error } = await this.client
      .from('vehicles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error !== null) throw new Error(`getVehicle: ${error.message}`);
    return data === null ? null : toVehicle(data as VehicleRow);
  }

  async addVehicle(input: NewVehicleInput): Promise<Vehicle> {
    const ownerId = this.userId();
    if (ownerId === null) throw new Error('addVehicle: not authenticated');

    const row = unwrap(
      await this.client
        .from('vehicles')
        .insert({
          owner_id: ownerId,
          make_id: input.makeId,
          model_id: input.modelId,
          year: input.year,
          // plate_normalised is a generated column — the server computes the
          // search key from this, and the client never supplies it.
          plate_en: input.plate ?? null,
          nickname: input.nickname ?? null,
          current_mileage: input.currentMileage ?? 0,
          created_by: ownerId,
        })
        .select()
        .single(),
      'addVehicle',
    );

    const vehicle = toVehicle(row as VehicleRow);

    // The registration event. Provenance is derived server-side — this call
    // cannot request a trust level (ADR-0005).
    const { error } = await this.client.rpc('append_vehicle_timeline_event', {
      p_vehicle_id: vehicle.id,
      p_event_type: 'vehicle_registered',
      p_summary_ar: 'تم تسجيل السيارة في هبّة',
      p_summary_en: 'Vehicle registered with Habba',
    });
    if (error !== null) throw new Error(`addVehicle/timeline: ${error.message}`);

    return vehicle;
  }

  async listTimeline(vehicleId: string): Promise<readonly TimelineEvent[]> {
    const rows = unwrap(
      await this.client
        .from('vehicle_timeline')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('occurred_at', { ascending: false }),
      'listTimeline',
    );

    return (rows as TimelineRow[]).map(toTimelineEvent);
  }

  async getProfile(): Promise<Profile | null> {
    const userId = this.userId();
    if (userId === null) return null;

    const { data, error } = await this.client
      .from('profiles')
      .select('id, full_name, phone, email, is_guest, preferred_locale')
      .eq('id', userId)
      .maybeSingle();

    if (error !== null) throw new Error(`getProfile: ${error.message}`);
    if (data === null) return null;

    return toProfile(data as ProfileRow);
  }

  async upsertProfile(profile: Omit<Profile, 'id'>): Promise<Profile> {
    const userId = this.userId();
    if (userId === null) throw new Error('upsertProfile: not authenticated');

    // Cast because the client is untyped: without generated database types
    // supabase-js infers `never` for the returned row. `supabase gen types
    // typescript` replaces these casts once a project exists (see types.ts).
    const row = unwrap(
      await this.client
        .from('profiles')
        .upsert({
          id: userId,
          full_name: profile.fullName,
          phone: profile.phone,
          email: profile.email,
          is_guest: profile.isGuest,
          preferred_locale: profile.preferredLocale,
        })
        .select('id, full_name, phone, email, is_guest, preferred_locale')
        .single(),
      'upsertProfile',
    ) as ProfileRow;

    return toProfile(row);
  }

  async signInAsGuest(): Promise<Profile> {
    // Supabase anonymous auth: a real auth.users row and a real uid, which is
    // what makes every existing RLS policy work for a guest unchanged
    // (migration 0039). Without this the guest would match no rows anywhere.
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error !== null) throw new Error(`signInAsGuest: ${error.message}`);

    const userId = data.user?.id;
    if (userId === undefined) throw new Error('signInAsGuest: no user returned');

    const row = unwrap(
      await this.client
        .from('profiles')
        .upsert({ id: userId, is_guest: true })
        .select('id, full_name, phone, email, is_guest, preferred_locale')
        .single(),
      'signInAsGuest',
    ) as ProfileRow;

    return toProfile(row);
  }

  async upgradeGuest(input: GuestUpgradeInput): Promise<Profile> {
    const userId = this.userId();
    if (userId === null) throw new Error('upgradeGuest: not authenticated');
    if (input.phone === undefined && input.email === undefined) {
      throw new Error('upgradeGuest: no identity supplied');
    }

    // An UPDATE on the caller's own row, not a new account: the uid is
    // preserved, so the vehicles and timeline the guest already owns stay
    // theirs. guard_profile_columns (0039) refuses is_guest = false with no
    // identity attached, so the two writes cannot be separated.
    const row = unwrap(
      await this.client
        .from('profiles')
        .update({
          full_name: input.fullName,
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.email === undefined ? {} : { email: input.email }),
          is_guest: false,
        })
        .eq('id', userId)
        .select('id, full_name, phone, email, is_guest, preferred_locale')
        .single(),
      'upgradeGuest',
    ) as ProfileRow;

    return toProfile(row);
  }

  async recordPastService(input: PastServiceInput): Promise<void> {
    // record_past_service takes no provenance parameter — the server decides,
    // and with no order attached it can only ever be self_reported or
    // self_documented (ADR-0005).
    const { error } = await this.client.rpc('record_past_service', {
      p_vehicle_id: input.vehicleId,
      p_summary_ar: input.summaryAr,
      p_occurred_at: input.occurredAt.toISOString(),
      p_mileage: input.mileage ?? null,
      p_details: input.details ?? {},
    });

    if (error !== null) throw new Error(`recordPastService: ${error.message}`);
  }

  async recordMileage(vehicleId: string, mileage: number): Promise<void> {
    const { error } = await this.client.rpc('record_mileage', {
      p_vehicle_id: vehicleId,
      p_mileage: mileage,
    });

    if (error !== null) throw new Error(`recordMileage: ${error.message}`);
  }

  async generateReport(vehicleId: string): Promise<string> {
    const { data, error } = await this.client.rpc('generate_habba_report', {
      p_vehicle_id: vehicleId,
    });

    // A broken chain surfaces here as a refusal, and the UI must say so
    // plainly rather than retrying — the logbook needs support, not another
    // attempt.
    if (error !== null) throw new Error(`generateReport: ${error.message}`);

    return data as string;
  }

  async listEmergencyServices(): Promise<readonly Service[]> {
    const rows = unwrap(
      await this.client
        .from('services')
        .select(
          'id, category, name_ar, name_en, description_ar, icon, base_price, requires_vehicle',
        )
        .eq('category', 'emergency')
        .eq('is_active', true)
        .order('sort_order'),
      'listEmergencyServices',
    );

    return (rows as ServiceRow[]).map(toService);
  }

  async createEmergencyOrder(input: NewEmergencyOrderInput): Promise<string> {
    const { data, error } = await this.client.rpc('create_emergency_order', {
      p_service_id: input.serviceId,
      p_lon: input.lon,
      p_lat: input.lat,
      p_vehicle_id: input.vehicleId ?? null,
      p_address_ar: input.addressAr ?? null,
      p_problem: input.problem ?? null,
      p_mileage: input.mileage ?? null,
    });

    if (error !== null) throw new Error(`createEmergencyOrder: ${error.message}`);
    return data as string;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const { data, error } = await this.client
      .from('orders')
      .select(
        'id, status, fulfilment_mode, vehicle_id, service_id, provider_id, service_address_ar, problem_description, quoted_amount, parts_amount, labour_amount, vat_amount, total_amount, escrow_status, completion_media',
      )
      .eq('id', orderId)
      .maybeSingle();

    if (error !== null) throw new Error(`getOrder: ${error.message}`);
    return data === null ? null : toOrder(data as OrderRow);
  }

  async getOrderProvider(providerId: string): Promise<ProviderSummary | null> {
    // Explicit column list, never `select()`: 0037 revoked national_id_encrypted
    // and iban_encrypted from every client role, and a bare `select()` asks for
    // every column and fails the whole query rather than just those two.
    const { data, error } = await this.client
      .from('providers')
      .select('id, business_name_ar, rating_avg, rating_count')
      .eq('id', providerId)
      .maybeSingle();

    if (error !== null) throw new Error(`getOrderProvider: ${error.message}`);
    if (data === null) return null;

    return {
      id: data.id,
      businessNameAr: data.business_name_ar,
      ratingAvg: data.rating_avg,
      ratingCount: data.rating_count,
    };
  }

  /**
   * Live progress for an active job (migration 0040).
   *
   * Two reads, both server-guarded. `order_live_progress` is a definer
   * function that returns a distance and an ETA but never the provider's
   * coordinates — 0018 keeps that position private, and the screens only ever
   * needed the derived figures. It returns no row at all when the fix is stale
   * or the journey is over, so "no data" is a real answer here rather than an
   * error to paper over.
   *
   * The handover code comes from `order_handovers`, whose only read policy is
   * the customer's: the provider being verified cannot select it. Both are
   * allowed to come back empty and the caller renders less, never something
   * invented.
   */
  async getOrderProgress(orderId: string): Promise<JobProgress | null> {
    const [progress, handover] = await Promise.all([
      this.client.rpc('order_live_progress', { p_order_id: orderId }),
      this.client
        .from('order_handovers')
        .select('code, verified_at')
        .eq('order_id', orderId)
        .maybeSingle(),
    ]);

    if (progress.error !== null) {
      throw new Error(`getOrderProgress: ${progress.error.message}`);
    }
    // A missing handover row is normal before acceptance, so it is not an
    // error — but a genuine failure still has to surface.
    if (handover.error !== null) {
      throw new Error(`getOrderProgress (handover): ${handover.error.message}`);
    }

    const row = (progress.data as readonly LiveProgressRow[] | null)?.[0];
    const code = handover.data?.code ?? undefined;

    if (row === undefined && code === undefined) return null;

    return {
      ...(row !== undefined
        ? {
            distanceKm: row.distance_m / 1000,
            etaMinutes: row.eta_minutes,
            lastUpdateAt: row.measured_at,
          }
        : {}),
      // Once verified there is nothing left to show — the technician has
      // already proved they are the right person.
      ...(code !== undefined && handover.data?.verified_at === null ? { handoverCode: code } : {}),
    };
  }

  /**
   * Open predictive alerts for one vehicle (migration 0028, §1.4).
   *
   * Dismissed and actioned alerts are filtered server-side by status rather
   * than here: an alert the owner has already dealt with reappearing on the
   * home screen is the fastest way to teach them to ignore the card.
   */
  async listMaintenanceAlerts(vehicleId: string): Promise<readonly MaintenanceAlert[]> {
    const rows = unwrap(
      await this.client
        .from('maintenance_alerts')
        .select(
          'id, vehicle_id, service_id, message_ar, message_en, due_at_km, estimated_km, confidence',
        )
        .eq('vehicle_id', vehicleId)
        .eq('status', 'open')
        .order('due_at_km', { ascending: true, nullsFirst: false }),
      'listMaintenanceAlerts',
    );

    return (rows as readonly MaintenanceAlertRow[]).map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      serviceId: row.service_id,
      messageAr: row.message_ar,
      messageEn: row.message_en,
      dueAtKm: row.due_at_km,
      estimatedKm: row.estimated_km,
      confidence: row.confidence,
    }));
  }

  async listRecentOrders(limit = 5): Promise<readonly OrderSummary[]> {
    // Joins the service for its Arabic name: the row reads "بنشر · قبل 3 أيام"
    // and an order id would tell the customer nothing.
    const rows = unwrap(
      await this.client
        .from('orders')
        .select('id, status, total_amount, created_at, services(name_ar)')
        .order('created_at', { ascending: false })
        .limit(limit),
      'listRecentOrders',
    );

    return (rows as readonly OrderSummaryRow[]).map((row) => ({
      id: row.id,
      status: row.status,
      serviceNameAr: row.services?.[0]?.name_ar ?? '',
      totalAmount: toSarOrNull(row.total_amount),
      createdAt: row.created_at,
    }));
  }

  async listOrderParts(orderId: string): Promise<readonly OrderPart[]> {
    const rows = unwrap(
      await this.client
        .from('order_parts')
        .select(
          'id, order_id, name_ar, part_number, is_oem, quantity, unit_price, warranty_days, approved_by_customer',
        )
        .eq('order_id', orderId)
        .order('created_at'),
      'listOrderParts',
    );

    return (rows as OrderPartRow[]).map(toOrderPart);
  }

  async approveOrderPart(partId: string): Promise<void> {
    // Direct UPDATE, not an RPC: guard_order_parts (0035) is the authority on
    // who may flip this column, and it already refuses anyone but the
    // customer on the order this line belongs to.
    const { error } = await this.client
      .from('order_parts')
      .update({ approved_by_customer: true, approved_at: new Date().toISOString() })
      .eq('id', partId);

    if (error !== null) throw new Error(`approveOrderPart: ${error.message}`);
  }

  async cancelOrder(orderId: string, reason?: string): Promise<void> {
    // Direct UPDATE: guard_order_columns (0033) permits the customer to
    // cancel their own order, and the state machine (0020) checks the
    // transition is legal for the order's current status.
    const { error } = await this.client
      .from('orders')
      .update({ status: 'cancelled', cancellation_reason: reason ?? null })
      .eq('id', orderId);

    if (error !== null) throw new Error(`cancelOrder: ${error.message}`);
  }

  async confirmOrderCompletion(orderId: string): Promise<void> {
    // Two steps, both enforced server-side: the status transition (only the
    // customer may make it, 0032) and the capture (only after status is
    // completed, 0033). Neither can be reordered by the client.
    const { error: statusError } = await this.client
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', orderId);
    if (statusError !== null) throw new Error(`confirmOrderCompletion: ${statusError.message}`);

    const { error: captureError } = await this.client.rpc('capture_order_payment', {
      p_order_id: orderId,
    });
    if (captureError !== null) {
      throw new Error(`confirmOrderCompletion/capture: ${captureError.message}`);
    }
  }

  async rateOrder(input: NewRatingInput): Promise<void> {
    const raterId = this.userId();
    if (raterId === null) throw new Error('rateOrder: not authenticated');

    const { error } = await this.client.from('ratings').insert({
      order_id: input.orderId,
      rater_id: raterId,
      provider_id: input.providerId,
      stars: input.stars,
      tags: input.tags ?? [],
      comment: input.comment ?? null,
    });

    if (error !== null) throw new Error(`rateOrder: ${error.message}`);
  }
}
