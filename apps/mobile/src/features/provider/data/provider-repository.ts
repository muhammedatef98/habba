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

import {
  riyadhDay,
  sarOrThrow,
  type CompletionMediaItem,
  type FulfilmentMode,
  type InspectionResultEntry,
  type InspectionTemplateSection,
  type OrderStatus,
  type Recommendation,
  type SarAmount,
} from '@habba/core';
import { storageRef } from '@/features/shared/lib/media-ref.js';
import { getSupabaseClient } from '@/features/shared/lib/supabase.js';

const COMPLETION_MEDIA_BUCKET = 'completion-media';

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
  /** The appointment time for a booked job; null for an emergency. */
  readonly scheduledFor: string | null;
  /** The inspection template this job is performed against, if any (0073). */
  readonly inspectionTemplateKey: string | null;
  /** The report is filed; required before hand-back when there is a template. */
  readonly inspectionFiled: boolean;
  /** A pre-purchase inspection has no vehicle: the car is not the customer's yet. */
  readonly hasVehicle: boolean;
  /** A free re-service of this technician's own earlier work (0105). */
  readonly isWarranty: boolean;
  /**
   * Present while the job is still an offer to this technician, not yet
   * theirs. What they need to decide — how far, how much — and nothing that
   * identifies the customer or where they are (ADR-0013).
   */
  readonly offer: Pick<
    OpenJob,
    'distanceBucket' | 'districtNameAr' | 'estimatedPayout' | 'hasTriageVideo'
  > | null;
}

/** The form an inspector fills in (0026). */
export interface InspectionTemplate {
  readonly key: string;
  readonly nameAr: string;
  readonly sections: readonly InspectionTemplateSection[];
}

/** The car an inspection is about, when it is not in Habba yet. */
export interface InspectionSubject {
  readonly vin: string | null;
  readonly plate: string | null;
  readonly makeAr: string | null;
  readonly modelAr: string | null;
  readonly year: number | null;
  readonly mileage: number | null;
}

export interface FiledInspection {
  readonly score: number | null;
  readonly recommendation: Recommendation | null;
}

/** A part the technician quoted, and where the customer's answer stands. */
export interface QuotedPart {
  readonly id: string;
  readonly nameAr: string;
  readonly partNumber: string | null;
  readonly isOem: boolean;
  readonly quantity: number;
  /** Before VAT, per unit. */
  readonly unitPrice: SarAmount;
  readonly warrantyDays: number | null;
  readonly answer: 'pending' | 'approved' | 'declined';
}

export interface NewPartInput {
  readonly nameAr: string;
  readonly partNumber?: string | undefined;
  readonly isOem: boolean;
  readonly quantity: number;
  readonly unitPrice: SarAmount;
  readonly warrantyDays?: number | undefined;
}

/**
 * How accepting went. Losing the race is a normal outcome — an emergency goes
 * to several technicians at once and one of them wins — not an error.
 */
export type AcceptOutcome = 'accepted' | 'taken';

export interface Position {
  readonly lon: number;
  readonly lat: number;
  readonly heading?: number | undefined;
}

/** One period's completed work (0095). Money is the server's 2dp strings. */
export interface EarningsPeriod {
  readonly jobs: number;
  readonly gross: string;
  /** After Habba's commission, as the payout will compute it. */
  readonly net: string;
}

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'failed';

export interface PayoutSummary {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly netAmount: string;
  readonly orderCount: number;
  readonly status: PayoutStatus;
  readonly paidAt: string | null;
}

export interface ProviderReview {
  readonly stars: number;
  readonly tags: readonly string[];
  readonly comment: string | null;
  readonly createdAt: string;
}

export interface CompletedJob {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly serviceNameAr: string;
  readonly serviceNameEn: string;
  readonly completedAt: string;
  readonly totalAmount: string;
  readonly net: string;
}

/**
 * Everything a technician's own dashboard shows, in one call (0095). The
 * server computes all of it — the net especially is its arithmetic, not the
 * app's (§2.2) — and refuses anyone who is not an approved provider.
 */
export interface ProviderDashboard {
  readonly profile: {
    readonly businessNameAr: string;
    readonly businessNameEn: string | null;
    readonly providerType: 'individual' | 'workshop';
    readonly cityNameAr: string;
    readonly cityNameEn: string;
    readonly ratingAvg: number;
    readonly ratingCount: number;
    readonly jobsCompleted: number;
    readonly acceptanceRate: number | null;
    readonly nafathVerified: boolean;
    readonly memberSince: string;
  };
  readonly periods: {
    readonly today: EarningsPeriod;
    readonly week: EarningsPeriod;
    readonly month: EarningsPeriod;
  };
  readonly unpaid: { readonly jobs: number; readonly net: string };
  readonly payouts: readonly PayoutSummary[];
  /** Visible reviews per star, 1–5. */
  readonly stars: Readonly<Record<'1' | '2' | '3' | '4' | '5', number>>;
  readonly reviews: readonly ProviderReview[];
  readonly recent: readonly CompletedJob[];
  /**
   * The last seven days, oldest first, today last (0098). Empty against a
   * server that predates it, so the chart simply does not draw.
   */
  readonly daily: readonly DailyEarnings[];
}

export interface DailyEarnings {
  /** Riyadh calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly jobs: number;
  readonly net: string;
}

interface DashboardRow {
  profile: {
    business_name_ar: string;
    business_name_en: string | null;
    provider_type: 'individual' | 'workshop';
    city_name_ar: string;
    city_name_en: string;
    rating_avg: number | string;
    rating_count: number;
    jobs_completed: number;
    acceptance_rate: number | string | null;
    nafath_verified: boolean;
    member_since: string;
  };
  periods: Record<'today' | 'week' | 'month', EarningsPeriod>;
  unpaid: { jobs: number; net: string };
  payouts: {
    id: string;
    period_start: string;
    period_end: string;
    net_amount: string;
    order_count: number;
    status: PayoutStatus;
    paid_at: string | null;
  }[];
  stars: Record<'1' | '2' | '3' | '4' | '5', number>;
  reviews: { stars: number; tags: string[]; comment: string | null; created_at: string }[];
  recent: {
    order_id: string;
    order_number: string;
    name_ar: string;
    name_en: string;
    completed_at: string;
    total_amount: string;
    net: string;
  }[];
  daily?: { day: string; jobs: number; net: string }[];
}

export function toDashboard(row: DashboardRow): ProviderDashboard {
  return {
    profile: {
      businessNameAr: row.profile.business_name_ar,
      businessNameEn: row.profile.business_name_en,
      providerType: row.profile.provider_type,
      cityNameAr: row.profile.city_name_ar,
      cityNameEn: row.profile.city_name_en,
      ratingAvg: Number(row.profile.rating_avg),
      ratingCount: row.profile.rating_count,
      jobsCompleted: row.profile.jobs_completed,
      acceptanceRate:
        row.profile.acceptance_rate === null ? null : Number(row.profile.acceptance_rate),
      nafathVerified: row.profile.nafath_verified,
      memberSince: row.profile.member_since,
    },
    periods: row.periods,
    daily: (row.daily ?? []).map((day) => ({ day: day.day, jobs: day.jobs, net: day.net })),
    unpaid: row.unpaid,
    payouts: row.payouts.map((payout) => ({
      id: payout.id,
      periodStart: payout.period_start,
      periodEnd: payout.period_end,
      netAmount: payout.net_amount,
      orderCount: payout.order_count,
      status: payout.status,
      paidAt: payout.paid_at,
    })),
    stars: row.stars,
    reviews: row.reviews.map((review) => ({
      stars: review.stars,
      tags: review.tags,
      comment: review.comment,
      createdAt: review.created_at,
    })),
    recent: row.recent.map((job) => ({
      orderId: job.order_id,
      orderNumber: job.order_number,
      serviceNameAr: job.name_ar,
      serviceNameEn: job.name_en,
      completedAt: job.completed_at,
      totalAmount: job.total_amount,
      net: job.net,
    })),
  };
}

/** One of the technician's own appointment times (0104). */
export interface MySlot {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** A customer holds it. */
  readonly booked: boolean;
  /** Closed to new bookings by the technician. */
  readonly blocked: boolean;
}

export interface PublishAvailabilityInput {
  /** Riyadh calendar days, `YYYY-MM-DD`. */
  readonly dates: readonly string[];
  /** Minutes after midnight, Riyadh. */
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
}

export interface ProviderRepository {
  setOnline(online: boolean): Promise<void>;
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
  acceptJob(orderId: string): Promise<AcceptOutcome>;
  advanceJob(orderId: string, toStatus: OrderStatus): Promise<void>;
  checkInVehicle(orderId: string): Promise<void>;
  /**
   * Uploads a photo taken on the job and returns the item to record for it.
   *
   * Throws on failure rather than returning a placeholder: a photo that did
   * not upload is a photo that was not taken, and the server refuses to
   * record one anyway (0064).
   */
  uploadEvidencePhoto(
    orderId: string,
    kind: CompletionMediaItem['kind'],
    localUri: string,
  ): Promise<CompletionMediaItem>;
  /**
   * The parts quote (0067). A new line always reaches the customer as a
   * question; the server refuses anything once the job is handed back.
   */
  listParts(orderId: string): Promise<readonly QuotedPart[]>;
  addPart(orderId: string, input: NewPartInput): Promise<void>;
  removePart(partId: string): Promise<void>;
  getInspectionTemplate(key: string): Promise<InspectionTemplate | null>;
  /**
   * Files the report (0026). Scored by the server, never here; once filed it
   * is final — it is evidence, and the order holds exactly one.
   */
  /** One item's photo, into the order's folder; returns its storage reference. */
  uploadInspectionPhoto(
    orderId: string,
    section: string,
    item: string,
    localUri: string,
  ): Promise<string>;
  submitInspection(
    orderId: string,
    templateKey: string,
    results: Readonly<Record<string, Readonly<Record<string, InspectionResultEntry>>>>,
    subject: InspectionSubject,
  ): Promise<FiledInspection>;
  /** Mileage, photos and the warranty given — one call, never half-saved. */
  recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
    warrantyDays: number,
  ): Promise<void>;
  /** The caller's own earnings, payouts, ratings and recent work (0095). */
  getDashboard(): Promise<ProviderDashboard>;
  /**
   * The customer's pin for a live job of this technician's (0099); null for a
   * workshop job, an offer not yet accepted, or a job that has ended.
   */
  getJobDestination(orderId: string): Promise<{ lat: number; lon: number } | null>;
  /** The caller's own coming appointment times, booked and closed included (0104). */
  listMySlots(days?: number): Promise<readonly MySlot[]>;
  /** Adds times on the chosen days; returns how many were new. */
  publishAvailability(input: PublishAvailabilityInput): Promise<number>;
  setSlotBlocked(slotId: string, blocked: boolean): Promise<void>;
  /** Whether the customer's handover code is issued, verified or locked — never the code (0106). */
  getHandoverStatus(orderId: string): Promise<HandoverStatus>;
  /** Tests the code the customer reads out; true when it matches (0047). */
  verifyHandoverCode(orderId: string, code: string): Promise<boolean>;
  /** The caller's workshop, or null before it has been set up (0107). */
  getMyWorkshop(): Promise<WorkshopProfile | null>;
  saveWorkshop(profile: WorkshopProfile): Promise<void>;
}

/** A workshop's own address, point, bays and hours (0023, 0107). */
export interface WorkshopProfile {
  readonly addressAr: string;
  readonly lat: number;
  readonly lon: number;
  readonly bayCount: number;
  /** `{"sun": [["08:00","20:00"]], ...}`; a missing day is closed. */
  readonly openingHours: Readonly<Record<string, readonly (readonly [string, string])[]>>;
}

export interface HandoverStatus {
  readonly issued: boolean;
  readonly verified: boolean;
  readonly locked: boolean;
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

    return (data as OpenJobRow[]).map(toOpenJob);
  }

  async listMyJobs(): Promise<readonly AssignedJob[]> {
    const { data, error } = await this.client
      .from('orders')
      .select(
        'id, order_number, status, fulfilment_mode, service_address_ar, problem_description, ' +
          'completion_mileage, completion_media, vehicle_id, scheduled_for, parent_order_id, ' +
          'services(name_ar, requires_completion_photos, requires_completion_mileage, inspection_template_key), ' +
          'vehicles(current_mileage), inspection_reports(id)',
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
          'completion_mileage, completion_media, vehicle_id, scheduled_for, parent_order_id, ' +
          'services(name_ar, requires_completion_photos, requires_completion_mileage, inspection_template_key), ' +
          'vehicles(current_mileage), inspection_reports(id)',
      )
      .eq('id', orderId)
      .maybeSingle();

    if (error !== null) throw new Error(`getJob: ${error.message}`);
    if (data !== null) return toAssignedJob(data);

    // Not yours yet, so RLS hides the order row — which is right (ADR-0013).
    // An offer is still something to open and decide on, so it is read
    // through the same masked listing the shift screen shows.
    const offer = (await this.listOpenJobs()).find((job) => job.orderId === orderId);
    return offer === undefined ? null : offerAsJob(offer);
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

  async acceptJob(orderId: string): Promise<AcceptOutcome> {
    // The RPC, never a table UPDATE: before acceptance this technician is not
    // the assigned provider, so RLS matches no row and a plain UPDATE
    // "succeeds" having changed nothing (0033). The RPC claims atomically —
    // of several technicians offered the job, exactly one gets it.
    const { data, error } = await this.client.rpc('accept_order', { p_order_id: orderId });
    if (error !== null) throw new Error(`acceptJob: ${error.message}`);
    return data === true ? 'accepted' : 'taken';
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

  async listParts(orderId: string): Promise<readonly QuotedPart[]> {
    const { data, error } = await this.client
      .from('order_parts')
      .select(
        'id, name_ar, part_number, is_oem, quantity, unit_price, warranty_days, approved_by_customer, declined_at',
      )
      .eq('order_id', orderId)
      .order('created_at');
    if (error !== null) throw new Error(`listParts: ${error.message}`);
    return (data as PartRow[]).map(toQuotedPart);
  }

  async addPart(orderId: string, input: NewPartInput): Promise<void> {
    const { error } = await this.client.from('order_parts').insert({
      order_id: orderId,
      name_ar: input.nameAr.trim(),
      part_number: input.partNumber?.trim() || null,
      is_oem: input.isOem,
      quantity: input.quantity,
      // The string, not a number: PostgREST passes it to numeric(12,2) intact.
      unit_price: input.unitPrice,
      warranty_days: input.warrantyDays ?? null,
    });
    if (error !== null) throw new Error(`addPart: ${error.message}`);
  }

  async removePart(partId: string): Promise<void> {
    const { error } = await this.client.from('order_parts').delete().eq('id', partId);
    if (error !== null) throw new Error(`removePart: ${error.message}`);
  }

  async uploadEvidencePhoto(
    orderId: string,
    kind: CompletionMediaItem['kind'],
    localUri: string,
  ): Promise<CompletionMediaItem> {
    const body = await (await fetch(localUri)).arrayBuffer();
    // `<order_id>/…` because the bucket's policies authorise on the first path
    // segment, and record_completion_evidence() only accepts this order's.
    const path = `${orderId}/${kind}-${Date.now()}.jpg`;

    const { error } = await this.client.storage
      .from(COMPLETION_MEDIA_BUCKET)
      .upload(path, body, { contentType: 'image/jpeg', upsert: false });
    if (error !== null) throw new Error(`uploadEvidencePhoto: ${error.message}`);

    return { url: storageRef(COMPLETION_MEDIA_BUCKET, path), kind };
  }

  async uploadInspectionPhoto(
    orderId: string,
    section: string,
    item: string,
    localUri: string,
  ): Promise<string> {
    const body = await (await fetch(localUri)).arrayBuffer();
    // Directly in the order's folder, named `insp-…`: the bucket authorises on
    // the first segment, and submit_inspection_report() accepts only this
    // order's inspection photos (0090).
    const safe = (key: string) => key.replace(/[^A-Za-z0-9_]/g, '_');
    const path = `${orderId}/insp-${safe(section)}-${safe(item)}-${Date.now()}.jpg`;

    const { error } = await this.client.storage
      .from(COMPLETION_MEDIA_BUCKET)
      .upload(path, body, { contentType: 'image/jpeg', upsert: false });
    if (error !== null) throw new Error(`uploadInspectionPhoto: ${error.message}`);

    return storageRef(COMPLETION_MEDIA_BUCKET, path);
  }

  async getInspectionTemplate(key: string): Promise<InspectionTemplate | null> {
    const { data, error } = await this.client
      .from('inspection_templates')
      .select('key, name_ar, sections')
      .eq('key', key)
      .eq('is_active', true)
      .maybeSingle();
    if (error !== null) throw new Error(`getInspectionTemplate: ${error.message}`);
    if (data === null) return null;
    const row = data as { key: string; name_ar: string; sections: InspectionTemplateSection[] };
    return { key: row.key, nameAr: row.name_ar, sections: row.sections };
  }

  async submitInspection(
    orderId: string,
    templateKey: string,
    results: Readonly<Record<string, Readonly<Record<string, InspectionResultEntry>>>>,
    subject: InspectionSubject,
  ): Promise<FiledInspection> {
    const { data, error } = await this.client.rpc('submit_inspection_report', {
      p_order_id: orderId,
      p_template_key: templateKey,
      p_results: results,
      p_subject_vin: subject.vin,
      p_subject_plate: subject.plate,
      p_subject_make_ar: subject.makeAr,
      p_subject_model_ar: subject.modelAr,
      p_subject_year: subject.year,
      p_subject_mileage: subject.mileage,
    });
    if (error !== null) throw new Error(`submitInspection: ${error.message}`);

    const filed = await this.client
      .from('inspection_reports')
      .select('overall_score, recommendation')
      .eq('id', data as string)
      .single();
    if (filed.error !== null) throw new Error(`submitInspection: ${filed.error.message}`);
    const row = filed.data as {
      overall_score: number | null;
      recommendation: Recommendation | null;
    };
    return { score: row.overall_score, recommendation: row.recommendation };
  }

  async recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
    warrantyDays: number,
  ): Promise<void> {
    // One call for all of it, so a half-saved completion cannot exist.
    const { error } = await this.client.rpc('record_completion_evidence', {
      p_order_id: orderId,
      p_mileage: mileage,
      p_media: media,
      p_warranty_days: warrantyDays,
    });
    if (error !== null) throw new Error(`recordEvidence: ${error.message}`);
  }

  async getDashboard(): Promise<ProviderDashboard> {
    const { data, error } = await this.client.rpc('provider_dashboard');
    if (error !== null) throw new Error(`getDashboard: ${error.message}`);
    return toDashboard(data as DashboardRow);
  }

  async getJobDestination(orderId: string): Promise<{ lat: number; lon: number } | null> {
    const { data, error } = await this.client.rpc('job_destination', { p_order_id: orderId });
    if (error !== null) throw new Error(`getJobDestination: ${error.message}`);
    const row = ((data ?? []) as { lat: number; lon: number }[])[0];
    return row === undefined ? null : { lat: row.lat, lon: row.lon };
  }
  async listMySlots(days = 14): Promise<readonly MySlot[]> {
    const { data, error } = await this.client.rpc('my_slots', { p_days: days });
    if (error !== null) throw new Error(`listMySlots: ${error.message}`);
    return (
      (data ?? []) as {
        id: string;
        starts_at: string;
        ends_at: string;
        capacity: number;
        booked_count: number;
        is_blocked: boolean;
      }[]
    ).map((row) => ({
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      booked: row.booked_count > 0,
      blocked: row.is_blocked,
    }));
  }

  async publishAvailability(input: PublishAvailabilityInput): Promise<number> {
    const { data, error } = await this.client.rpc('publish_availability', {
      p_dates: [...input.dates],
      p_start_minute: input.startMinute,
      p_end_minute: input.endMinute,
      p_slot_minutes: input.slotMinutes,
    });
    if (error !== null) throw new Error(`publishAvailability: ${error.message}`);
    return Number(data ?? 0);
  }

  async setSlotBlocked(slotId: string, blocked: boolean): Promise<void> {
    const { error } = await this.client.rpc('set_slot_blocked', {
      p_slot_id: slotId,
      p_blocked: blocked,
    });
    if (error !== null) throw new Error(`setSlotBlocked: ${error.message}`);
  }
  async getHandoverStatus(orderId: string): Promise<HandoverStatus> {
    const { data, error } = await this.client.rpc('handover_status', { p_order_id: orderId });
    if (error !== null) throw new Error(`getHandoverStatus: ${error.message}`);
    const row = ((data ?? []) as HandoverStatus[])[0];
    return row ?? { issued: false, verified: false, locked: false };
  }

  async verifyHandoverCode(orderId: string, code: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('verify_handover_code', {
      p_order_id: orderId,
      p_code: code,
    });
    if (error !== null) {
      throw new Error(
        error.code === '23514' ? 'handover:locked' : `verifyHandoverCode: ${error.message}`,
      );
    }
    return data === true;
  }
  async getMyWorkshop(): Promise<WorkshopProfile | null> {
    const { data, error } = await this.client.rpc('my_workshop');
    if (error !== null) throw new Error(`getMyWorkshop: ${error.message}`);
    const row = (
      (data ?? []) as {
        address_ar: string;
        lat: number;
        lon: number;
        bay_count: number;
        opening_hours: WorkshopProfile['openingHours'];
      }[]
    )[0];
    return row === undefined
      ? null
      : {
          addressAr: row.address_ar,
          lat: row.lat,
          lon: row.lon,
          bayCount: row.bay_count,
          openingHours: row.opening_hours ?? {},
        };
  }

  async saveWorkshop(profile: WorkshopProfile): Promise<void> {
    const { error } = await this.client.rpc('upsert_workshop', {
      p_address_ar: profile.addressAr,
      p_lon: profile.lon,
      p_lat: profile.lat,
      p_bay_count: profile.bayCount,
      p_opening_hours: profile.openingHours,
    });
    if (error !== null) throw new Error(`saveWorkshop: ${error.message}`);
  }
}

interface OrderRow {
  id: string;
  parent_order_id?: string | null;
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
    inspection_template_key?: string | null;
  } | null;
  vehicles: { current_mileage: number } | null;
  scheduled_for: string | null;
  vehicle_id?: string | null;
  // One-to-one through the unique order_id, so PostgREST embeds an object —
  // or an array on older versions; both are read.
  inspection_reports?: { id: string } | { id: string }[] | null;
}

interface PartRow {
  id: string;
  name_ar: string;
  part_number: string | null;
  is_oem: boolean;
  quantity: number;
  unit_price: number;
  warranty_days: number | null;
  approved_by_customer: boolean;
  declined_at: string | null;
}

function toQuotedPart(row: PartRow): QuotedPart {
  return {
    id: row.id,
    nameAr: row.name_ar,
    partNumber: row.part_number,
    isOem: row.is_oem,
    quantity: row.quantity,
    // PostgREST serialises numeric as a JSON number; back to exact SAR at once.
    unitPrice: sarOrThrow(Number(row.unit_price).toFixed(2)),
    warrantyDays: row.warranty_days,
    answer: row.approved_by_customer
      ? 'approved'
      : row.declined_at !== null
        ? 'declined'
        : 'pending',
  };
}

function toOpenJob(row: OpenJobRow): OpenJob {
  return {
    orderId: row.order_id,
    serviceId: row.service_id,
    serviceNameAr: row.service_name_ar,
    fulfilmentMode: row.fulfilment_mode,
    distanceBucket: row.distance_bucket,
    districtNameAr: row.district_name_ar,
    problemSummary: row.problem_summary,
    hasTriageVideo: row.has_triage_video,
    estimatedPayout: row.estimated_payout,
  };
}

function offerAsJob(offer: OpenJob): AssignedJob {
  return {
    orderId: offer.orderId,
    orderNumber: '',
    status: 'searching',
    fulfilmentMode: offer.fulfilmentMode,
    serviceNameAr: offer.serviceNameAr,
    addressAr: null,
    problemDescription: offer.problemSummary,
    completionMileage: null,
    completionMedia: [],
    requiresCompletionPhotos: true,
    requiresCompletionMileage: true,
    vehicleCurrentMileage: null,
    scheduledFor: null,
    inspectionTemplateKey: null,
    inspectionFiled: false,
    hasVehicle: false,
    isWarranty: false,
    offer: {
      distanceBucket: offer.distanceBucket,
      districtNameAr: offer.districtNameAr,
      estimatedPayout: offer.estimatedPayout,
      hasTriageVideo: offer.hasTriageVideo,
    },
  };
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
    scheduledFor: order.scheduled_for ?? null,
    inspectionTemplateKey: order.services?.inspection_template_key ?? null,
    inspectionFiled: Array.isArray(order.inspection_reports)
      ? order.inspection_reports.length > 0
      : order.inspection_reports !== null && order.inspection_reports !== undefined,
    hasVehicle: order.vehicle_id !== null && order.vehicle_id !== undefined,
    isWarranty: order.parent_order_id !== null && order.parent_order_id !== undefined,
    offer: null,
  };
}

/** The one offer the dev build shows a technician who goes online. */
const DEV_OPEN_JOB: OpenJob = {
  orderId: 'dev-open-1',
  serviceId: 'dev-service-1',
  serviceNameAr: 'بطارية — شحن أو تبديل',
  fulfilmentMode: 'mobile_ondemand',
  distanceBucket: 'أقل من ٢ كم',
  districtNameAr: 'الرياض',
  problemSummary: 'السيارة لا تعمل',
  hasTriageVideo: false,
  estimatedPayout: '120.00',
};

/** A short form for the dev build; the real one is seeded by 0027. */
const DEV_INSPECTION_TEMPLATE: InspectionTemplate = {
  key: 'pre_purchase_v1',
  nameAr: 'فحص ما قبل الشراء',
  sections: [
    {
      key: 'engine',
      title_ar: 'المحرك',
      weight: 3,
      items: [
        { key: 'oil_leaks', label_ar: 'تسريب زيت', required: true, weight: 2 },
        { key: 'cold_start', label_ar: 'التشغيل البارد', required: true, weight: 2 },
        { key: 'belts', label_ar: 'السيور', required: false },
      ],
    },
    {
      key: 'body',
      title_ar: 'الهيكل',
      weight: 2,
      items: [{ key: 'accident_evidence', label_ar: 'آثار حوادث', required: true, weight: 3 }],
    },
  ],
};

/** What the demo build shows a technician: a plausible first month. */
const DEV_DASHBOARD: ProviderDashboard = {
  profile: {
    businessNameAr: 'فنّي هبّة',
    businessNameEn: 'Habba technician',
    providerType: 'individual',
    cityNameAr: 'الدمام',
    cityNameEn: 'Dammam',
    ratingAvg: 4.8,
    ratingCount: 23,
    jobsCompleted: 31,
    acceptanceRate: 92,
    nafathVerified: true,
    memberSince: '2026-08-02T09:00:00Z',
  },
  periods: {
    today: { jobs: 2, gross: '345.00', net: '297.00' },
    week: { jobs: 7, gross: '1265.00', net: '1089.00' },
    month: { jobs: 24, gross: '4380.00', net: '3771.00' },
  },
  // Relative to today, so the dev chart always ends on the day it is opened;
  // today matches `periods.today` above.
  daily: [
    ['0.00', 0],
    ['215.00', 1],
    ['138.00', 1],
    ['0.00', 0],
    ['312.00', 2],
    ['127.00', 1],
    ['297.00', 2],
  ].map(([net, jobs], index) => ({
    day: riyadhDay(new Date(Date.now() - (6 - index) * 86_400_000)),
    jobs: Number(jobs),
    net: String(net),
  })),
  unpaid: { jobs: 7, net: '1089.00' },
  payouts: [
    {
      id: 'dev-payout-2',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      netAmount: '1312.50',
      orderCount: 9,
      status: 'paid',
      paidAt: '2026-09-22T10:00:00Z',
    },
    {
      id: 'dev-payout-1',
      periodStart: '2026-09-07',
      periodEnd: '2026-09-13',
      netAmount: '1369.50',
      orderCount: 8,
      status: 'paid',
      paidAt: '2026-09-15T10:00:00Z',
    },
  ],
  stars: { '1': 0, '2': 0, '3': 1, '4': 3, '5': 19 },
  reviews: [
    {
      stars: 5,
      tags: ['سرعة', 'احترافية'],
      comment: 'وصل خلال ربع ساعة وشرح المشكلة بوضوح.',
      createdAt: '2026-09-27T18:20:00Z',
    },
    { stars: 5, tags: ['نظافة'], comment: null, createdAt: '2026-09-26T12:05:00Z' },
    {
      stars: 4,
      tags: ['سعر مناسب'],
      comment: 'تأخر قليلاً لكن الشغل ممتاز.',
      createdAt: '2026-09-24T09:40:00Z',
    },
  ],
  recent: [
    {
      orderId: 'dev-done-3',
      orderNumber: 'HB-2026-000231',
      serviceNameAr: 'بطارية — شحن أو تبديل',
      serviceNameEn: 'Battery boost or swap',
      completedAt: '2026-09-28T08:40:00Z',
      totalAmount: '172.50',
      net: '148.50',
    },
    {
      orderId: 'dev-done-2',
      orderNumber: 'HB-2026-000228',
      serviceNameAr: 'تغيير زيت وفلتر',
      serviceNameEn: 'Oil and filter change',
      completedAt: '2026-09-28T06:10:00Z',
      totalAmount: '172.50',
      net: '148.50',
    },
    {
      orderId: 'dev-done-1',
      orderNumber: 'HB-2026-000219',
      serviceNameAr: 'بنشر وتبديل إطار',
      serviceNameEn: 'Flat tyre',
      completedAt: '2026-09-26T15:30:00Z',
      totalAmount: '115.00',
      net: '99.00',
    },
  ],
};

/** In-memory stand-in, used until a Supabase project exists (ADR-0010). */
export class InMemoryProviderRepository implements ProviderRepository {
  private online = false;
  private readonly jobs = new Map<string, AssignedJob>();

  async setOnline(online: boolean): Promise<void> {
    this.online = online;
  }

  async broadcastLocation(): Promise<void> {
    /* no-op */
  }

  async listOpenJobs(): Promise<readonly OpenJob[]> {
    if (!this.online || this.jobs.has(DEV_OPEN_JOB.orderId)) return [];
    return [DEV_OPEN_JOB];
  }

  async listMyJobs(): Promise<readonly AssignedJob[]> {
    return [...this.jobs.values()];
  }

  async getJob(orderId: string): Promise<AssignedJob | null> {
    const job = this.jobs.get(orderId);
    if (job !== undefined) return job;
    return this.online && orderId === DEV_OPEN_JOB.orderId ? offerAsJob(DEV_OPEN_JOB) : null;
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

  async acceptJob(orderId: string): Promise<AcceptOutcome> {
    this.jobs.set(orderId, {
      orderId,
      orderNumber: 'HB-DEV-000001',
      status: 'accepted',
      fulfilmentMode: 'mobile_ondemand',
      serviceNameAr: 'بطارية — شحن أو تبديل',
      addressAr: 'حي الفيصلية، شارع ١٢',
      problemDescription: 'السيارة لا تعمل',
      completionMileage: null,
      completionMedia: [],
      requiresCompletionPhotos: true,
      requiresCompletionMileage: true,
      vehicleCurrentMileage: 45000,
      scheduledFor: null,
      inspectionTemplateKey: null,
      inspectionFiled: false,
      hasVehicle: true,
      isWarranty: false,
      offer: null,
    });
    return 'accepted';
  }

  async advanceJob(orderId: string, toStatus: OrderStatus): Promise<void> {
    const job = this.jobs.get(orderId);
    if (job !== undefined) this.jobs.set(orderId, { ...job, status: toStatus });
  }

  async checkInVehicle(orderId: string): Promise<void> {
    await this.advanceJob(orderId, 'checked_in');
  }

  private readonly parts = new Map<string, QuotedPart[]>();
  private partCounter = 0;

  async listParts(orderId: string): Promise<readonly QuotedPart[]> {
    return this.parts.get(orderId) ?? [];
  }

  // No customer on the other end in the dev build, so a quoted part stays
  // pending — which is exactly the state the technician's screen has to show.
  async addPart(orderId: string, input: NewPartInput): Promise<void> {
    this.partCounter += 1;
    const line: QuotedPart = {
      id: `dev-part-${this.partCounter}`,
      nameAr: input.nameAr.trim(),
      partNumber: input.partNumber?.trim() || null,
      isOem: input.isOem,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      warrantyDays: input.warrantyDays ?? null,
      answer: 'pending',
    };
    this.parts.set(orderId, [...(this.parts.get(orderId) ?? []), line]);
  }

  async removePart(partId: string): Promise<void> {
    for (const [orderId, lines] of this.parts) {
      this.parts.set(
        orderId,
        lines.filter((line) => line.id !== partId),
      );
    }
  }

  // No storage in the in-memory build. The photo is still a real one — the
  // camera took it — so its local file is recorded, which displays as it is.
  async uploadEvidencePhoto(
    _orderId: string,
    kind: CompletionMediaItem['kind'],
    localUri: string,
  ): Promise<CompletionMediaItem> {
    return { url: localUri, kind };
  }

  // As with evidence photos: no storage here, so the camera's file stands in.
  async uploadInspectionPhoto(
    _orderId: string,
    _section: string,
    _item: string,
    localUri: string,
  ): Promise<string> {
    return localUri;
  }

  async getInspectionTemplate(key: string): Promise<InspectionTemplate | null> {
    return key === DEV_INSPECTION_TEMPLATE.key ? DEV_INSPECTION_TEMPLATE : null;
  }

  async submitInspection(orderId: string): Promise<FiledInspection> {
    const job = this.jobs.get(orderId);
    if (job !== undefined) this.jobs.set(orderId, { ...job, inspectionFiled: true });
    return { score: 88, recommendation: 'buy' };
  }

  async recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
    _warrantyDays: number,
  ): Promise<void> {
    const job = this.jobs.get(orderId);
    if (job !== undefined) {
      this.jobs.set(orderId, { ...job, completionMileage: mileage, completionMedia: media });
    }
  }

  async getDashboard(): Promise<ProviderDashboard> {
    return DEV_DASHBOARD;
  }

  async getJobDestination(orderId: string): Promise<{ lat: number; lon: number } | null> {
    const job = this.jobs.get(orderId);
    // The dev job's district, Al-Faisaliyah in Riyadh.
    return job !== undefined && job.addressAr !== null ? { lat: 24.6907, lon: 46.6853 } : null;
  }
  private slots: MySlot[] = [];

  async listMySlots(): Promise<readonly MySlot[]> {
    const now = new Date().toISOString();
    return this.slots.filter((slot) => slot.startsAt > now);
  }

  async publishAvailability(input: PublishAvailabilityInput): Promise<number> {
    let added = 0;
    for (const day of input.dates) {
      for (
        let minute = input.startMinute;
        minute + input.slotMinutes <= input.endMinute;
        minute += input.slotMinutes
      ) {
        // Riyadh is UTC+3 all year.
        const starts = new Date(Date.parse(`${day}T00:00:00Z`) + (minute - 180) * 60_000);
        if (starts.getTime() <= Date.now()) continue;
        const startsAt = starts.toISOString();
        if (this.slots.some((slot) => slot.startsAt === startsAt)) continue;
        this.slots.push({
          id: `dev-slot-${startsAt}`,
          startsAt,
          endsAt: new Date(starts.getTime() + input.slotMinutes * 60_000).toISOString(),
          booked: false,
          blocked: false,
        });
        added += 1;
      }
    }
    this.slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return added;
  }

  async setSlotBlocked(slotId: string, blocked: boolean): Promise<void> {
    this.slots = this.slots.map((slot) => (slot.id === slotId ? { ...slot, blocked } : slot));
  }
  private readonly handovers = new Map<string, { verified: boolean; attempts: number }>();

  async getHandoverStatus(orderId: string): Promise<HandoverStatus> {
    const state = this.handovers.get(orderId) ?? { verified: false, attempts: 0 };
    return { issued: true, verified: state.verified, locked: state.attempts >= 5 };
  }

  async verifyHandoverCode(orderId: string, code: string): Promise<boolean> {
    const state = this.handovers.get(orderId) ?? { verified: false, attempts: 0 };
    if (state.verified) return true;
    if (state.attempts >= 5) throw new Error('handover:locked');
    // The dev build's code, shown on the customer's arrived screen.
    const matched = code === '4827';
    this.handovers.set(orderId, { verified: matched, attempts: state.attempts + 1 });
    return matched;
  }
  private workshop: WorkshopProfile | null = null;

  async getMyWorkshop(): Promise<WorkshopProfile | null> {
    return this.workshop;
  }

  async saveWorkshop(profile: WorkshopProfile): Promise<void> {
    this.workshop = profile;
  }
}

function createRepository(): ProviderRepository {
  const client = getSupabaseClient();
  return client === null
    ? new InMemoryProviderRepository()
    : new SupabaseProviderRepository(client);
}

export const providerRepository: ProviderRepository = createRepository();
