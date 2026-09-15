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
  type InspectionResultEntry,
  type InspectionTemplateSection,
  type CompletionMediaItem,
  type CompletionMediaKind,
  type FulfilmentMode,
  type OrderStatus,
  type SarAmount,
} from '@habba/core';
import { getSupabaseClient } from '@/features/shared/lib/supabase.js';
import type { OrderPart } from '@/features/shared/data/types.js';
import { locationProvider } from '@/features/shared/lib/location.js';
import type { LocationProvider } from '@/features/shared/lib/location-provider.js';

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

export type ServiceCategory = 'emergency' | 'periodic' | 'inspection' | 'wash' | 'bodywork';

export interface AssignedJob {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly fulfilmentMode: FulfilmentMode;
  readonly serviceNameAr: string;
  /**
   * What kind of work this is.
   *
   * Carried so the job screen can offer the inspection form on an inspection
   * and not on a battery swap. Deriving it from the service NAME would be a
   * string match against copy somebody will edit.
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
}

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'failed';

/**
 * One job's contribution to what the technician is owed.
 *
 * ⚠️ `gross` includes VAT and `commission` is taken only on parts + labour, so
 * `net` is NOT `gross × (1 − rate)`. The three are carried separately rather
 * than derived on the device because the server is the only thing allowed to
 * decide them (0067) — and because a screen that recomputed them would be a
 * second implementation of the arithmetic that pays this person.
 */
export interface EarningLine {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly serviceNameAr: string;
  readonly completedAt: string;
  readonly gross: SarAmount;
  readonly commission: SarAmount;
  readonly net: SarAmount;
}

export interface EarningsSummary {
  readonly unsettledCount: number;
  readonly unsettledGross: SarAmount;
  readonly unsettledCommission: SarAmount;
  readonly unsettledNet: SarAmount;
  /** Only payouts actually marked `paid`. An approved one is a promise. */
  readonly paidNet: SarAmount;
  readonly lastPaidAt: string | null;
}

export interface PayoutSummary {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly grossAmount: SarAmount;
  readonly commission: SarAmount;
  readonly netAmount: SarAmount;
  readonly orderCount: number;
  readonly status: PayoutStatus;
  readonly paidAt: string | null;
  readonly reference: string | null;
}

export interface Position {
  readonly lon: number;
  readonly lat: number;
  readonly heading?: number | undefined;
}

/**
 * Why this is a result and not a thrown error.
 *
 * A denied location permission is a normal outcome, not an exception: the
 * technician tapped "don't allow" once, months ago, and has no idea that is why
 * no work is arriving. The two failures need different words on the screen —
 * one is fixed in iOS Settings and the other fixes itself when they drive out
 * of the basement — so the reason has to survive the trip back to the caller.
 */
export type PositionResult =
  | { readonly ok: true; readonly position: Position }
  | { readonly ok: false; readonly reason: 'permission_denied' | 'unavailable' };

export interface ProviderRepository {
  setOnline(online: boolean): Promise<void>;
  currentPosition(): Promise<PositionResult>;
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
  /**
   * Stores one evidence photo and returns the reference to record on the order,
   * or null if it did not land.
   *
   * ⚠️ Null must never be treated as "close enough". Until this resolves with a
   * path there is no photo, and an item added to `completion_media` anyway is a
   * timeline attachment pointing at nothing — signed, hash-chained, and empty.
   * That is the failure 0064 was written about.
   */
  uploadCompletionPhoto(
    orderId: string,
    kind: CompletionMediaKind,
    uri: string,
  ): Promise<string | null>;
  recordEvidence(
    orderId: string,
    mileage: number,
    media: readonly CompletionMediaItem[],
  ): Promise<void>;

  /**
   * الأرباح. What this provider is owed and what they have been paid.
   *
   * ⚠️ None of these take a provider id, and that is the access control rather
   * than a convenience: the RPCs behind them read `current_provider_id()`
   * server-side. The id-taking version, `payable_order_lines`, is revoked from
   * `authenticated` entirely (0067) — an argument is a thing a client can
   * change, and this one would change whose earnings you read.
   */
  getEarningsSummary(): Promise<EarningsSummary | null>;
  listUnsettledEarnings(): Promise<readonly EarningLine[]>;
  listPayouts(): Promise<readonly PayoutSummary[]>;
  listPayoutLines(payoutId: string): Promise<readonly EarningLine[]>;

  /**
   * عرض السعر — the parts and labour that make up what the customer is asked
   * to approve (§1's sixth differentiator).
   *
   * ⚠️ No method sets a total. `parts_amount`, `vat_amount` and `total_amount`
   * are derived server-side from the lines and the labour (0068); a client that
   * could write them would be a second implementation of the VAT arithmetic,
   * and the one that decides what the customer pays.
   */
  listQuoteParts(orderId: string): Promise<readonly OrderPart[]>;
  addQuotePart(orderId: string, part: NewQuotePart): Promise<void>;
  removeQuotePart(partId: string): Promise<void>;
  setLabour(orderId: string, labour: SarAmount): Promise<void>;

  /**
   * الفحص. The template an inspection is filled against, and the filing of it.
   *
   * ⚠️ `submitInspection` sends ratings and notes — never a score and never a
   * recommendation. `submit_inspection_report` (0026) computes both from the
   * weighted template, and the table has no INSERT policy at all, so a
   * hand-written row carrying a flattering score is not something the client
   * can produce. That is the property the whole feature rests on: a buyer is
   * about to hand over money on the strength of this number.
   */
  getInspectionTemplate(key: string): Promise<InspectionTemplateRow | null>;
  submitInspection(input: InspectionSubmission): Promise<string>;
}

export interface InspectionTemplateRow {
  readonly id: string;
  readonly key: string;
  readonly nameAr: string;
  readonly sections: readonly InspectionTemplateSection[];
}

export interface InspectionSubmission {
  readonly orderId: string;
  readonly templateKey: string;
  readonly results: Readonly<Record<string, Record<string, InspectionResultEntry>>>;
  /**
   * The car's identity, carried by the report itself.
   *
   * A pre-purchase inspection runs against a car nobody in the system owns, so
   * there is no `vehicles` row to borrow a VIN and plate from — and the server
   * refuses a report that identifies its subject by neither (0026's
   * `inspection_subject_identified`).
   */
  readonly subjectVin: string | null;
  readonly subjectPlate: string | null;
  readonly subjectMakeAr: string | null;
  readonly subjectModelAr: string | null;
  readonly subjectYear: number | null;
  readonly subjectMileage: number | null;
}

/** What the provider types in. Everything else about the line is derived. */
export interface NewQuotePart {
  readonly nameAr: string;
  readonly partNumber: string | null;
  readonly isOem: boolean;
  readonly quantity: number;
  readonly unitPrice: SarAmount;
  readonly warrantyDays: number | null;
}

/**
 * Postgres `numeric` arrives as a JS number through PostgREST.
 *
 * Routed through `sarOrThrow` rather than kept as a number, because
 * `SarAmount` is the only form the rest of the app will do arithmetic or
 * comparison on (ADR-0007) — and because a float that silently became
 * 474.99999999999994 must fail loudly here rather than be shown to someone as
 * what they are owed.
 */
function toSar(value: number | string | null): SarAmount {
  if (value === null) return sarOrThrow('0.00');
  return sarOrThrow(typeof value === 'string' ? value : value.toFixed(2));
}

interface EarningLineRow {
  order_id: string;
  order_number: string;
  service_name_ar: string;
  completed_at: string;
  gross: number | string;
  commission: number | string;
  net: number | string;
}

function toEarningLine(row: EarningLineRow): EarningLine {
  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    serviceNameAr: row.service_name_ar,
    completedAt: row.completed_at,
    gross: toSar(row.gross),
    commission: toSar(row.commission),
    net: toSar(row.net),
  };
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
  constructor(
    private readonly client: NonNullable<ReturnType<typeof getSupabaseClient>>,
    private readonly location: LocationProvider = locationProvider,
  ) {}

  async setOnline(online: boolean): Promise<void> {
    // Going offline also clears the stored position server-side — battery and
    // privacy both (§9.2).
    const { error } = await this.client.rpc('set_provider_online', { p_online: online });
    if (error !== null) throw new Error(`setOnline: ${error.message}`);
  }

  /**
   * ⚠️ This used to throw unconditionally, with a comment promising that the
   * native build supplied it. Nothing did. On a hosted project every broadcast
   * tick raised, `update_provider_location` was never called, and
   * `match_providers` — which filters on a fix newer than
   * `location_freshness_limit()` — could not see the technician at all. They
   * went online, watched "موقعك قديم" forever, and received no work, with no
   * way to tell that from a quiet night.
   *
   * The provider it now uses is the same one the customer's emergency flow has
   * used since it was built (`shared/lib/location.ts`): real GPS in a build
   * that can ask for permission, the fixed Dammam stub otherwise.
   */
  async currentPosition(): Promise<PositionResult> {
    const result = await this.location.getCurrentLocation();
    if (!result.ok) return { ok: false, reason: result.reason };

    return {
      ok: true,
      position: {
        lon: result.location.lon,
        lat: result.location.lat,
        heading: result.location.heading ?? undefined,
      },
    };
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

  /**
   * Uploads to the private `completion-media` bucket (0064).
   *
   * Keyed `<order_id>/<filename>`, because the bucket's policies authorise on
   * the first path segment — an object anywhere else matches no order and is
   * refused. Nothing here checks that; RLS does.
   *
   * What comes back is the PATH, not a signed URL. The same reasoning as the
   * triage clip: a signed URL expires, and this reference is about to be
   * written into a timeline attachment that is permanent and hash-chained. A
   * row whose contents stop resolving after an hour is not a record.
   *
   * Unlike the triage clip, a failure here is NOT swallowed. That clip is a
   * courtesy and the rescue proceeds without it; this photo is the thing the
   * customer's resale value is made of, and the server will refuse to let the
   * job be handed back without it. Returning null so the screen can say so is
   * the entire point.
   */
  async uploadCompletionPhoto(
    orderId: string,
    kind: CompletionMediaKind,
    uri: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(uri);
      const body = await response.arrayBuffer();
      const path = `${orderId}/${kind}-${Date.now()}.jpg`;

      const upload = await this.client.storage
        .from('completion-media')
        .upload(path, body, { contentType: 'image/jpeg', upsert: false });

      return upload.error === null ? path : null;
    } catch {
      return null;
    }
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

  async getEarningsSummary(): Promise<EarningsSummary | null> {
    const { data, error } = await this.client.rpc('my_earnings_summary');
    if (error !== null) throw new Error(`getEarningsSummary: ${error.message}`);

    // Returns no row for a user with no provider record. Null rather than a
    // zeroed summary, so the screen can tell "nothing yet" from "not a
    // provider" instead of showing someone a confident 0.00 ﷼.
    const row = (data as readonly Record<string, number | string | null>[] | null)?.[0];
    if (row === undefined) return null;

    return {
      unsettledCount: Number(row['unsettled_count'] ?? 0),
      unsettledGross: toSar(row['unsettled_gross'] ?? null),
      unsettledCommission: toSar(row['unsettled_commission'] ?? null),
      unsettledNet: toSar(row['unsettled_net'] ?? null),
      paidNet: toSar(row['paid_net'] ?? null),
      lastPaidAt: (row['last_paid_at'] as string | null) ?? null,
    };
  }

  async listUnsettledEarnings(): Promise<readonly EarningLine[]> {
    const { data, error } = await this.client.rpc('my_unsettled_orders');
    if (error !== null) throw new Error(`listUnsettledEarnings: ${error.message}`);
    return (data as EarningLineRow[]).map(toEarningLine);
  }

  async listPayouts(): Promise<readonly PayoutSummary[]> {
    // A plain table read: `payouts_read` (0031) already scopes it to
    // `current_provider_id()`, so there is nothing for an RPC to add.
    const { data, error } = await this.client
      .from('payouts')
      .select(
        'id, period_start, period_end, gross_amount, commission, net_amount, ' +
          'order_count, status, paid_at, reference',
      )
      .order('period_end', { ascending: false });

    if (error !== null) throw new Error(`listPayouts: ${error.message}`);

    return (data as unknown as PayoutRow[]).map((row) => ({
      id: row.id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      grossAmount: toSar(row.gross_amount),
      commission: toSar(row.commission),
      netAmount: toSar(row.net_amount),
      orderCount: row.order_count,
      status: row.status,
      paidAt: row.paid_at,
      reference: row.reference,
    }));
  }

  async listPayoutLines(payoutId: string): Promise<readonly EarningLine[]> {
    const { data, error } = await this.client.rpc('my_payout_lines', { p_payout_id: payoutId });
    if (error !== null) throw new Error(`listPayoutLines: ${error.message}`);
    return (data as EarningLineRow[]).map(toEarningLine);
  }

  async listQuoteParts(orderId: string): Promise<readonly OrderPart[]> {
    const { data, error } = await this.client
      .from('order_parts')
      .select(
        'id, order_id, name_ar, part_number, is_oem, quantity, unit_price, ' +
          'warranty_days, approved_by_customer',
      )
      .eq('order_id', orderId)
      .order('created_at');

    if (error !== null) throw new Error(`listQuoteParts: ${error.message}`);

    return (data as unknown as OrderPartRow[]).map((row) => ({
      id: row.id,
      orderId: row.order_id,
      nameAr: row.name_ar,
      partNumber: row.part_number,
      isOem: row.is_oem,
      quantity: row.quantity,
      unitPrice: toSar(row.unit_price),
      warrantyDays: row.warranty_days,
      approvedByCustomer: row.approved_by_customer,
    }));
  }

  /**
   * A plain INSERT, not an RPC.
   *
   * `order_parts_write_provider` (0022) already scopes writes to the assigned
   * provider, `guard_order_part_window` (0068) refuses a line on a job that is
   * no longer open, and the reprice trigger recomputes the order's totals the
   * moment the row lands. There is nothing left for an RPC to add — and one
   * that took the totals as arguments would be handing the client the decision
   * this whole design keeps on the server.
   */
  async addQuotePart(orderId: string, part: NewQuotePart): Promise<void> {
    const { error } = await this.client.from('order_parts').insert({
      order_id: orderId,
      name_ar: part.nameAr,
      part_number: part.partNumber,
      is_oem: part.isOem,
      quantity: part.quantity,
      unit_price: part.unitPrice,
      warranty_days: part.warrantyDays,
    });

    if (error !== null) throw new Error(`addQuotePart: ${error.message}`);
  }

  async removeQuotePart(partId: string): Promise<void> {
    const { error } = await this.client.from('order_parts').delete().eq('id', partId);
    if (error !== null) throw new Error(`removeQuotePart: ${error.message}`);
  }

  async setLabour(orderId: string, labour: SarAmount): Promise<void> {
    const { error } = await this.client.rpc('set_order_labour', {
      p_order_id: orderId,
      p_labour: labour,
    });
    if (error !== null) throw new Error(`setLabour: ${error.message}`);
  }

  async getInspectionTemplate(key: string): Promise<InspectionTemplateRow | null> {
    const { data, error } = await this.client
      .from('inspection_templates')
      .select('id, key, name_ar, sections')
      .eq('key', key)
      .eq('is_active', true)
      .maybeSingle();

    if (error !== null) throw new Error(`getInspectionTemplate: ${error.message}`);
    if (data === null) return null;

    const row = data as unknown as {
      id: string;
      key: string;
      name_ar: string;
      sections: InspectionTemplateSection[];
    };

    return { id: row.id, key: row.key, nameAr: row.name_ar, sections: row.sections };
  }

  async submitInspection(input: InspectionSubmission): Promise<string> {
    const { data, error } = await this.client.rpc('submit_inspection_report', {
      p_order_id: input.orderId,
      p_template_key: input.templateKey,
      p_results: input.results,
      p_subject_vin: input.subjectVin,
      p_subject_plate: input.subjectPlate,
      p_subject_make_ar: input.subjectMakeAr,
      p_subject_model_ar: input.subjectModelAr,
      p_subject_year: input.subjectYear,
      p_subject_mileage: input.subjectMileage,
    });

    // ⚠️ Surfaced, never swallowed. The server refuses an incomplete report and
    // names what is missing; an inspector who saw that silently succeed would
    // walk away believing they had filed something.
    if (error !== null) throw new Error(error.message);
    return data as string;
  }
}

interface OrderPartRow {
  id: string;
  order_id: string;
  name_ar: string;
  part_number: string | null;
  is_oem: boolean;
  quantity: number;
  unit_price: number | string;
  warranty_days: number | null;
  approved_by_customer: boolean;
}

interface PayoutRow {
  id: string;
  period_start: string;
  period_end: string;
  gross_amount: number | string;
  commission: number | string;
  net_amount: number | string;
  order_count: number;
  status: PayoutStatus;
  paid_at: string | null;
  reference: string | null;
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
    serviceCategory: order.services?.category ?? 'emergency',
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

  async currentPosition(): Promise<PositionResult> {
    return { ok: true, position: { lon: 46.6753, lat: 24.7136 } };
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
      serviceCategory: 'emergency',
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

  /**
   * There is no bucket in the dev build, so this names itself as a stand-in.
   *
   * The `dev://` scheme is deliberate and the reason it is here rather than in
   * the screen. A fabricated reference that read `habba://captured/...` used to
   * live in `evidence.tsx`, which meant it applied to a real hosted build too:
   * the gap list cleared, the server's before/after count was satisfied, and a
   * hash-chained attachment pointed at a file that had never existed. Confined
   * to the in-memory repository — which only exists when there is no Supabase
   * project at all (ADR-0010) — it can no longer reach a customer's logbook.
   */
  async uploadCompletionPhoto(orderId: string, kind: CompletionMediaKind): Promise<string | null> {
    return `dev://${orderId}/${kind}-${Date.now()}.jpg`;
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

  /**
   * Fixed figures, and they reconcile.
   *
   * 345 + 230 gross, commission taken on parts+labour only (60 + 40), so the
   * net is 475 — the same worked example as `supabase/tests/39`. A dev fixture
   * whose three numbers do not add up teaches whoever is building the screen to
   * ignore the one property the screen exists to show.
   */
  async getEarningsSummary(): Promise<EarningsSummary | null> {
    return {
      unsettledCount: 2,
      unsettledGross: sarOrThrow('575.00'),
      unsettledCommission: sarOrThrow('100.00'),
      unsettledNet: sarOrThrow('475.00'),
      paidNet: sarOrThrow('1840.00'),
      lastPaidAt: '2026-09-01T09:00:00.000Z',
    };
  }

  async listUnsettledEarnings(): Promise<readonly EarningLine[]> {
    return [
      {
        orderId: 'dev-done-1',
        orderNumber: 'HB-DEV-000041',
        serviceNameAr: 'بطارية — شحن أو تبديل',
        completedAt: '2026-09-12T18:20:00.000Z',
        gross: sarOrThrow('345.00'),
        commission: sarOrThrow('60.00'),
        net: sarOrThrow('285.00'),
      },
      {
        orderId: 'dev-done-2',
        orderNumber: 'HB-DEV-000039',
        serviceNameAr: 'تغيير زيت',
        completedAt: '2026-09-10T11:05:00.000Z',
        gross: sarOrThrow('230.00'),
        commission: sarOrThrow('40.00'),
        net: sarOrThrow('190.00'),
      },
    ];
  }

  async listPayouts(): Promise<readonly PayoutSummary[]> {
    return [
      {
        id: 'dev-payout-1',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        grossAmount: sarOrThrow('2300.00'),
        commission: sarOrThrow('460.00'),
        netAmount: sarOrThrow('1840.00'),
        orderCount: 8,
        status: 'paid',
        paidAt: '2026-09-01T09:00:00.000Z',
        reference: 'HB-PAY-0801',
      },
    ];
  }

  async listPayoutLines(): Promise<readonly EarningLine[]> {
    return this.listUnsettledEarnings();
  }

  private readonly parts = new Map<string, OrderPart[]>();

  async listQuoteParts(orderId: string): Promise<readonly OrderPart[]> {
    return this.parts.get(orderId) ?? [];
  }

  async addQuotePart(orderId: string, part: NewQuotePart): Promise<void> {
    const lines = this.parts.get(orderId) ?? [];
    lines.push({
      id: `dev-part-${lines.length + 1}-${Date.now()}`,
      orderId,
      nameAr: part.nameAr,
      partNumber: part.partNumber,
      isOem: part.isOem,
      quantity: part.quantity,
      unitPrice: part.unitPrice,
      warrantyDays: part.warrantyDays,
      // Never pre-approved. The dev build must not make the approval gate look
      // like it passes itself — that gate is the whole point of the screen.
      approvedByCustomer: false,
    });
    this.parts.set(orderId, lines);
  }

  async removeQuotePart(partId: string): Promise<void> {
    for (const [orderId, lines] of this.parts) {
      const kept = lines.filter((line) => line.id !== partId);
      if (kept.length !== lines.length) this.parts.set(orderId, kept);
    }
  }

  async setLabour(): Promise<void> {
    // No totals to recompute: there is no order row here carrying them, and
    // inventing one would be inventing the arithmetic 0068 keeps on the server.
  }

  /**
   * A two-section stand-in, not the real eleven-section template.
   *
   * Enough to exercise the capture screen's navigation, progress and
   * completeness behaviour offline. Deliberately includes one optional item and
   * one required one in the same section, because that is the combination the
   * screen gets wrong if `required` is ignored.
   */
  async getInspectionTemplate(key: string): Promise<InspectionTemplateRow | null> {
    return {
      id: 'dev-template-1',
      key,
      nameAr: 'فحص ما قبل الشراء (نسخة التطوير)',
      sections: [
        {
          key: 'engine',
          title_ar: 'المحرّك',
          items: [
            { key: 'oil_leaks', label_ar: 'تسريب زيت', required: true, weight: 2 },
            { key: 'cold_start', label_ar: 'التشغيل البارد', required: true },
            { key: 'belts', label_ar: 'السيور' },
          ],
        },
        {
          key: 'brakes',
          title_ar: 'الفرامل',
          items: [
            { key: 'pads', label_ar: 'الفحمات', required: true },
            { key: 'discs', label_ar: 'الهوبات', required: true },
          ],
        },
      ],
    };
  }

  async submitInspection(): Promise<string> {
    // No scoring here on purpose. The score is the server's (0026) and a dev
    // stub that invented one would teach whoever builds against it that the
    // client may produce a number a buyer will act on.
    return 'dev-inspection-report-1';
  }
}

function createRepository(): ProviderRepository {
  const client = getSupabaseClient();
  return client === null
    ? new InMemoryProviderRepository()
    : new SupabaseProviderRepository(client);
}

export const providerRepository: ProviderRepository = createRepository();
