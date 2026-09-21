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

import type {
  CompletionMediaItem,
  FulfilmentMode,
  InspectionTemplateSection,
  OrderStatus,
} from '@habba/core';
import {
  devInspections,
  type InspectionStore,
} from '@/features/shared/data/dev-inspection-store.js';
import type {
  InspectionForm,
  ServiceCategory,
  SubmitInspectionInput,
} from '@/features/shared/data/types.js';
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
  /**
   * What kind of work this is. The job screen offers «تعبئة تقرير الفحص» on
   * an `inspection` and nothing else — an inspection's deliverable is the
   * report, and a technician changing a battery has no form to fill.
   */
  readonly serviceCategory: ServiceCategory;
  /** Only present once assigned — before that the server will not return it. */
  readonly addressAr: string | null;
  readonly problemDescription: string | null;
  readonly completionMileage: number | null;
  readonly completionMedia: readonly CompletionMediaItem[];
  readonly requiresCompletionPhotos: boolean;
  readonly requiresCompletionMileage: boolean;
  readonly vehicleCurrentMileage: number | null;
  /**
   * Null on a pre-purchase inspection — the car belongs to nobody in Habba
   * yet, which is what makes the inspector responsible for identifying it.
   */
  readonly vehicleId: string | null;
}

export interface Position {
  readonly lon: number;
  readonly lat: number;
  readonly heading?: number | undefined;
}

/**
 * The one template the app files against, named here rather than chosen by
 * the caller — see `getInspectionForm`. When a second template ships it will
 * be selected by the SERVICE, from the order, not by whoever is filling it.
 */
const PRE_PURCHASE_TEMPLATE_KEY = 'pre_purchase_v1';

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

  // الفحص — the inspector's side of Phase 5 (0026).
  //
  // Note there is no `scoreInspection` here, and no field on the input that
  // carries a score. The number is computed by `submit_inspection_report` from
  // the template's own weights; the client mirror in @habba/core exists to
  // show the inspector what they are about to file, never to file it.
  /**
   * The form to fill for this job: the template as the database defines it,
   * plus whether this order's car still needs identifying.
   *
   * Null when the job is not an inspection, which is also how the job screen
   * decides not to offer the form at all.
   */
  getInspectionForm(orderId: string): Promise<InspectionForm | null>;
  /**
   * Files the report. Returns the report id.
   *
   * Throws when a required item is unanswered or the car is unidentified —
   * both mirrored client-side first, so the refusal arrives while the
   * inspector is still standing at the car rather than after it has driven
   * away.
   */
  submitInspection(input: SubmitInspectionInput): Promise<string>;
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
          'services(name_ar, category, requires_completion_photos, requires_completion_mileage), ' +
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
          'services(name_ar, category, requires_completion_photos, requires_completion_mileage), ' +
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

  async getInspectionForm(orderId: string): Promise<InspectionForm | null> {
    const { data, error } = await this.client
      .from('orders')
      .select('id, vehicle_id, services(category)')
      .eq('id', orderId)
      .maybeSingle();

    if (error !== null) throw new Error(`getInspectionForm: ${error.message}`);
    if (data === null) return null;

    const order = data as unknown as {
      vehicle_id: string | null;
      services: { category: ServiceCategory } | null;
    };
    if (order.services?.category !== 'inspection') return null;

    // Active templates only, and the client does not choose which: the key is
    // fixed here rather than passed in, because a caller that could name its
    // own template could name one whose items are all optional and file a
    // report that scores 100 on an empty form.
    const template = await this.client
      .from('inspection_templates')
      .select('key, name_ar, sections')
      .eq('key', PRE_PURCHASE_TEMPLATE_KEY)
      .eq('is_active', true)
      .maybeSingle();

    if (template.error !== null) throw new Error(`getInspectionForm: ${template.error.message}`);
    if (template.data === null) return null;

    const row = template.data as unknown as {
      key: string;
      name_ar: string;
      sections: readonly InspectionTemplateSection[];
    };

    // `order_id` is unique on `inspection_reports`, so a filed report means
    // the form is closed. Reading it back is what lets the screen say so
    // rather than letting the inspector fill forty-three items twice.
    const filed = await this.client
      .from('inspection_reports')
      .select('id')
      .eq('order_id', orderId)
      .maybeSingle();

    if (filed.error !== null) throw new Error(`getInspectionForm: ${filed.error.message}`);

    return {
      orderId,
      templateKey: row.key,
      templateNameAr: row.name_ar,
      sections: row.sections,
      subjectRequired: order.vehicle_id === null,
      filedReportId: (filed.data as { id: string } | null)?.id ?? null,
    };
  }

  async submitInspection(input: SubmitInspectionInput): Promise<string> {
    const { data, error } = await this.client.rpc('submit_inspection_report', {
      p_order_id: input.orderId,
      p_template_key: input.templateKey,
      p_results: input.results,
      p_subject_vin: input.subject.vin ?? null,
      p_subject_plate: input.subject.plate ?? null,
      p_subject_make_ar: input.subject.makeAr ?? null,
      p_subject_model_ar: input.subject.modelAr ?? null,
      p_subject_year: input.subject.year ?? null,
      p_subject_mileage: input.subject.mileage ?? null,
    });

    // As the server wrote it: the incompleteness refusal names the items that
    // are missing, and throwing that away would leave the inspector with
    // "something is wrong" in front of a car they are about to hand back.
    if (error !== null) throw new Error(error.message);

    return data as string;
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
  vehicle_id: string | null;
  services: {
    name_ar: string;
    category: ServiceCategory;
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
    // Defaults to the commonest category rather than to `inspection`: a job
    // whose category failed to load must not offer a report form that
    // `submit_inspection_report` would refuse.
    serviceCategory: order.services?.category ?? 'emergency',
    addressAr: order.service_address_ar,
    problemDescription: order.problem_description,
    completionMileage: order.completion_mileage,
    completionMedia: order.completion_media ?? [],
    requiresCompletionPhotos: order.services?.requires_completion_photos ?? true,
    requiresCompletionMileage: order.services?.requires_completion_mileage ?? true,
    vehicleCurrentMileage: order.vehicles?.current_mileage ?? null,
    vehicleId: order.vehicle_id,
  };
}

/**
 * The dev build's offers.
 *
 * Two of them, and the second one is a pre-purchase inspection with no
 * vehicle: it is the only job shape that asks the inspector to identify the
 * car themselves, and the only one whose deliverable is a form. A dev
 * repository offering nothing but a battery call would leave the whole
 * inspection surface unreachable without a database.
 */
const DEV_OPEN_JOBS: readonly OpenJob[] = [
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
  {
    orderId: 'dev-open-2',
    serviceId: 'svc-inspection',
    serviceNameAr: 'فحص ما قبل الشراء',
    fulfilmentMode: 'mobile_scheduled',
    distanceBucket: 'أقل من ٥ كم',
    districtNameAr: 'الرياض',
    problemSummary: 'فحص قبل الشراء — معرض سيارات',
    hasTriageVideo: false,
    estimatedPayout: '350.00',
  },
];

/** In-memory stand-in, used until a Supabase project exists (ADR-0010). */
export class InMemoryProviderRepository implements ProviderRepository {
  private online = false;
  private readonly jobs = new Map<string, AssignedJob>();

  /**
   * The filed-inspection store, shared with the customer-side repository —
   * in production these two actors reach one row. Injectable so a test can
   * hand both the same fresh store; see `dev-inspection-store.ts`.
   */
  constructor(private readonly inspections: InspectionStore = devInspections) {}

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
    return DEV_OPEN_JOBS;
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
    const offer = DEV_OPEN_JOBS.find((job) => job.orderId === orderId);
    const isInspection = offer?.serviceId === 'svc-inspection';

    this.jobs.set(orderId, {
      orderId,
      orderNumber: 'HB-DEV-000001',
      status: 'accepted',
      fulfilmentMode: offer?.fulfilmentMode ?? 'mobile_ondemand',
      serviceNameAr: offer?.serviceNameAr ?? 'بطارية — شحن أو تبديل',
      serviceCategory: isInspection ? 'inspection' : 'emergency',
      addressAr: isInspection ? 'معرض السيارات، طريق الملك عبدالله' : 'حي الفيصلية، شارع ١٢',
      problemDescription: offer?.problemSummary ?? 'السيارة ما تشتغل',
      completionMileage: null,
      completionMedia: [],
      requiresCompletionPhotos: true,
      requiresCompletionMileage: true,
      // An inspection is against a car Habba has never seen: no vehicle row,
      // and therefore no odometer to read back.
      vehicleCurrentMileage: isInspection ? null : 45000,
      vehicleId: isInspection ? null : 'veh-1',
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

  async getInspectionForm(orderId: string): Promise<InspectionForm | null> {
    const job = this.jobs.get(orderId);
    if (job === undefined || job.serviceCategory !== 'inspection') return null;

    return {
      orderId,
      templateKey: this.inspections.templateKey(),
      templateNameAr: this.inspections.templateNameAr(),
      sections: this.inspections.sections(),
      subjectRequired: job.vehicleId === null,
      filedReportId: this.inspections.forOrder(orderId)?.reportId ?? null,
    };
  }

  async submitInspection(input: SubmitInspectionInput): Promise<string> {
    const job = this.jobs.get(input.orderId);

    // The store does the scoring and every refusal, from the same mirror the
    // screen scores with — so the dev build cannot file something production
    // would reject, nor reject something production would take.
    return this.inspections.file({
      orderId: input.orderId,
      results: input.results,
      subject: input.subject,
      vehicleId: job?.vehicleId ?? null,
    });
  }
}

function createRepository(): ProviderRepository {
  const client = getSupabaseClient();
  return client === null
    ? new InMemoryProviderRepository()
    : new SupabaseProviderRepository(client);
}

export const providerRepository: ProviderRepository = createRepository();
