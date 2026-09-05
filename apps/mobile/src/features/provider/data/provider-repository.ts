/**
 * Provider-side data access.
 *
 * Same pattern as the customer app: an interface with a Supabase
 * implementation and an in-memory one, chosen by configuration, because no
 * project exists yet (ADR-0010).
 *
 * Note what the interface cannot express: there is no method that reads an
 * unassigned order's address, because the server has no such capability to
 * expose (ADR-0013). The shape of this file reflects the shape of the
 * permission model rather than working around it.
 */

import type { CompletionMediaItem, FulfilmentMode, OrderStatus } from '@habba/core';
import { getSupabaseClient } from '@/features/shared/lib/supabase.js';

export interface OpenJob {
  readonly orderId: string;
  readonly serviceId: string;
  readonly serviceNameAr: string;
  readonly fulfilmentMode: FulfilmentMode;
  /** A bucket, never a distance. Exact metres allow trilateration. */
  readonly distanceBucket: string;
  readonly districtNameAr: string | null;
  readonly problemSummary: string;
  readonly hasTriageVideo: boolean;
  readonly estimatedPayout: string | null;
}

export interface AssignedJob {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilmentMode: FulfilmentMode;
  readonly serviceNameAr: string;
  /** Only present once assigned — before that the server will not return it. */
  readonly addressAr: string | null;
  readonly problemDescription: string | null;
  readonly completionMileage: number | null;
  readonly completionMedia: readonly CompletionMediaItem[];
  readonly requiresCompletionPhotos: boolean;
  readonly requiresCompletionMileage: boolean;
  readonly vehicleCurrentMileage: number | null;
}

export interface Position {
  readonly lon: number;
  readonly lat: number;
  readonly heading?: number | undefined;
}

export interface ProviderRepository {
  setOnline(online: boolean): Promise<void>;
  currentPosition(): Promise<Position>;
  broadcastLocation(position: Position): Promise<void>;
  listOpenJobs(): Promise<readonly OpenJob[]>;
  listMyJobs(): Promise<readonly AssignedJob[]>;
  getJob(orderId: string): Promise<AssignedJob | null>;
  /**
   * Records that this provider opened the offer (0043).
   *
   * Moves the customer's "reviewing" counter, which is the whole argument of
   * their waiting screen — a number that changes because something real
   * happened rather than a spinner.
   */
  markOfferViewed(orderId: string): Promise<void>;
  /** Declines an offer so the dispatcher can widen instead of waiting. */
  declineOffer(orderId: string): Promise<void>;
  acceptJob(orderId: string): Promise<void>;
  advanceJob(orderId: string, toStatus: OrderStatus): Promise<void>;
  checkInVehicle(orderId: string): Promise<void>;
  recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
  ): Promise<void>;
}

interface OpenJobRow {
  order_id: string;
  service_id: string;
  service_name_ar: string;
  fulfilment_mode: FulfilmentMode;
  distance_bucket: string;
  district_name_ar: string | null;
  problem_summary: string;
  has_triage_video: boolean;
  estimated_payout: string | null;
}

export class SupabaseProviderRepository implements ProviderRepository {
  constructor(private readonly client: NonNullable<ReturnType<typeof getSupabaseClient>>) {}

  async setOnline(online: boolean): Promise<void> {
    // Going offline also clears the stored position server-side — battery and
    // privacy both (§9.2).
    const { error } = await this.client.rpc('set_provider_online', { p_online: online });
    if (error !== null) throw new Error(`setOnline: ${error.message}`);
  }

  async currentPosition(): Promise<Position> {
    // expo-location is wired in the native build; this keeps the data layer
    // free of a native dependency so it stays testable in Node.
    throw new Error('currentPosition must be supplied by the platform layer');
  }

  async broadcastLocation(position: Position): Promise<void> {
    const { error } = await this.client.rpc('update_provider_location', {
      p_lon: position.lon,
      p_lat: position.lat,
      p_heading: position.heading ?? null,
    });
    if (error !== null) throw new Error(`broadcastLocation: ${error.message}`);
  }

  async listOpenJobs(): Promise<readonly OpenJob[]> {
    // The masked RPC — there is no table read that would return more.
    const { data, error } = await this.client.rpc('list_open_orders_for_provider');
    if (error !== null) throw new Error(`listOpenJobs: ${error.message}`);

    return (data as OpenJobRow[]).map((row) => ({
      orderId: row.order_id,
      serviceId: row.service_id,
      serviceNameAr: row.service_name_ar,
      fulfilmentMode: row.fulfilment_mode,
      distanceBucket: row.distance_bucket,
      districtNameAr: row.district_name_ar,
      problemSummary: row.problem_summary,
      hasTriageVideo: row.has_triage_video,
      estimatedPayout: row.estimated_payout,
    }));
  }

  async listMyJobs(): Promise<readonly AssignedJob[]> {
    const { data, error } = await this.client
      .from('orders')
      .select(
        'id, order_number, status, fulfilment_mode, service_address_ar, problem_description, ' +
          'completion_mileage, completion_media, vehicle_id, ' +
          'services(name_ar, requires_completion_photos, requires_completion_mileage), ' +
          'vehicles(current_mileage)',
      )
      .in('status', [
        'accepted',
        'en_route',
        'arrived',
        'checked_in',
        'in_progress',
        'awaiting_approval',
      ])
      .order('created_at', { ascending: false });

    if (error !== null) throw new Error(`listMyJobs: ${error.message}`);
    return (data as unknown[]).map(toAssignedJob);
  }

  async getJob(orderId: string): Promise<AssignedJob | null> {
    const { data, error } = await this.client
      .from('orders')
      .select(
        'id, order_number, status, fulfilment_mode, service_address_ar, problem_description, ' +
          'completion_mileage, completion_media, vehicle_id, ' +
          'services(name_ar, requires_completion_photos, requires_completion_mileage), ' +
          'vehicles(current_mileage)',
      )
      .eq('id', orderId)
      .maybeSingle();

    if (error !== null) throw new Error(`getJob: ${error.message}`);
    return data === null ? null : toAssignedJob(data);
  }

  async markOfferViewed(orderId: string): Promise<void> {
    // Deliberately not surfaced as an error to the caller. Failing to record a
    // view must never stop a technician opening a job — the telemetry is for
    // the customer's reassurance, not a precondition for work.
    await this.client.rpc('mark_offer_viewed', { p_order_id: orderId });
  }

  async declineOffer(orderId: string): Promise<void> {
    const { error } = await this.client.rpc('decline_offer', { p_order_id: orderId });
    if (error !== null) throw new Error(`declineOffer: ${error.message}`);
  }

  async acceptJob(orderId: string): Promise<void> {
    const { error } = await this.client
      .from('orders')
      .update({ status: 'accepted' })
      .eq('id', orderId);
    if (error !== null) throw new Error(`acceptJob: ${error.message}`);
  }

  async advanceJob(orderId: string, toStatus: OrderStatus): Promise<void> {
    const { error } = await this.client
      .from('orders')
      .update({ status: toStatus })
      .eq('id', orderId);
    if (error !== null) throw new Error(`advanceJob: ${error.message}`);
  }

  async checkInVehicle(orderId: string): Promise<void> {
    const { error } = await this.client.rpc('check_in_vehicle', { p_order_id: orderId });
    if (error !== null) throw new Error(`checkInVehicle: ${error.message}`);
  }

  async recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
  ): Promise<void> {
    // One call for both halves, so a half-saved completion cannot exist.
    const { error } = await this.client.rpc('record_completion_evidence', {
      p_order_id: orderId,
      p_mileage: mileage,
      p_media: media,
    });
    if (error !== null) throw new Error(`recordEvidence: ${error.message}`);
  }
}

interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfilment_mode: FulfilmentMode;
  service_address_ar: string | null;
  problem_description: string | null;
  completion_mileage: number | null;
  completion_media: CompletionMediaItem[] | null;
  services: {
    name_ar: string;
    requires_completion_photos: boolean;
    requires_completion_mileage: boolean;
  } | null;
  vehicles: { current_mileage: number } | null;
}

function toAssignedJob(row: unknown): AssignedJob {
  const order = row as OrderRow;
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    fulfilmentMode: order.fulfilment_mode,
    serviceNameAr: order.services?.name_ar ?? '',
    addressAr: order.service_address_ar,
    problemDescription: order.problem_description,
    completionMileage: order.completion_mileage,
    completionMedia: order.completion_media ?? [],
    requiresCompletionPhotos: order.services?.requires_completion_photos ?? true,
    requiresCompletionMileage: order.services?.requires_completion_mileage ?? true,
    vehicleCurrentMileage: order.vehicles?.current_mileage ?? null,
  };
}

/** In-memory stand-in, used until a Supabase project exists (ADR-0010). */
export class InMemoryProviderRepository implements ProviderRepository {
  private online = false;
  private readonly jobs = new Map<string, AssignedJob>();

  async setOnline(online: boolean): Promise<void> {
    this.online = online;
  }

  async currentPosition(): Promise<Position> {
    return { lon: 46.6753, lat: 24.7136 };
  }

  async broadcastLocation(): Promise<void> {
    /* no-op */
  }

  async listOpenJobs(): Promise<readonly OpenJob[]> {
    if (!this.online) return [];
    return [
      {
        orderId: 'dev-open-1',
        serviceId: 'dev-service-1',
        serviceNameAr: 'بطارية — شحن أو تبديل',
        fulfilmentMode: 'mobile_ondemand',
        distanceBucket: 'أقل من ٢ كم',
        districtNameAr: 'الرياض',
        problemSummary: 'السيارة ما تشتغل',
        hasTriageVideo: false,
        estimatedPayout: '120.00',
      },
    ];
  }

  async listMyJobs(): Promise<readonly AssignedJob[]> {
    return [...this.jobs.values()];
  }

  async getJob(orderId: string): Promise<AssignedJob | null> {
    return this.jobs.get(orderId) ?? null;
  }

  // No offers table in the dev build, so there is nothing to record. Silent
  // rather than throwing: the customer-facing counter is the only thing that
  // depends on this, and it is not worth a technician seeing an error for.
  async markOfferViewed(): Promise<void> {
    return;
  }

  async declineOffer(orderId: string): Promise<void> {
    this.jobs.delete(orderId);
  }

  async acceptJob(orderId: string): Promise<void> {
    this.jobs.set(orderId, {
      orderId,
      orderNumber: 'HB-DEV-000001',
      status: 'accepted',
      fulfilmentMode: 'mobile_ondemand',
      serviceNameAr: 'بطارية — شحن أو تبديل',
      addressAr: 'حي الفيصلية، شارع ١٢',
      problemDescription: 'السيارة ما تشتغل',
      completionMileage: null,
      completionMedia: [],
      requiresCompletionPhotos: true,
      requiresCompletionMileage: true,
      vehicleCurrentMileage: 45000,
    });
  }

  async advanceJob(orderId: string, toStatus: OrderStatus): Promise<void> {
    const job = this.jobs.get(orderId);
    if (job !== undefined) this.jobs.set(orderId, { ...job, status: toStatus });
  }

  async checkInVehicle(orderId: string): Promise<void> {
    await this.advanceJob(orderId, 'checked_in');
  }

  async recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
  ): Promise<void> {
    const job = this.jobs.get(orderId);
    if (job !== undefined) {
      this.jobs.set(orderId, { ...job, completionMileage: mileage, completionMedia: media });
    }
  }
}

function createRepository(): ProviderRepository {
  const client = getSupabaseClient();
  return client === null
    ? new InMemoryProviderRepository()
    : new SupabaseProviderRepository(client);
}

export const providerRepository: ProviderRepository = createRepository();
