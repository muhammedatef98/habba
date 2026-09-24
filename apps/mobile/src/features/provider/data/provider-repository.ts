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
          'completion_mileage, completion_media, vehicle_id, scheduled_for, ' +
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
          'completion_mileage, completion_media, vehicle_id, scheduled_for, ' +
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
  problemSummary: 'السيارة ما تشتغل',
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
      problemDescription: 'السيارة ما تشتغل',
      completionMileage: null,
      completionMedia: [],
      requiresCompletionPhotos: true,
      requiresCompletionMileage: true,
      vehicleCurrentMileage: 45000,
      scheduledFor: null,
      inspectionTemplateKey: null,
      inspectionFiled: false,
      hasVehicle: true,
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
}

function createRepository(): ProviderRepository {
  const client = getSupabaseClient();
  return client === null
    ? new InMemoryProviderRepository()
    : new SupabaseProviderRepository(client);
}

export const providerRepository: ProviderRepository = createRepository();
