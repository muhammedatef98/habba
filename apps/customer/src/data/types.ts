/**
 * Domain types for the customer app, mirroring the Phase 1 schema.
 *
 * These are hand-written for now. Once a Supabase project exists (ADR-0010),
 * they are replaced by `supabase gen types typescript`, which generates them
 * from the migrations and removes the risk of drift.
 */

import type { FulfilmentMode, OrderStatus, SarAmount } from '@habba/core';

export type Provenance = 'self_reported' | 'self_documented' | 'habba_verified' | 'third_party';

export type TimelineEventType =
  | 'vehicle_registered'
  | 'service_completed'
  | 'inspection_completed'
  | 'parts_replaced'
  | 'mileage_recorded'
  | 'warranty_claimed'
  | 'ownership_transferred'
  | 'alert_raised'
  | 'alert_dismissed';

export interface VehicleMake {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

export interface VehicleModel {
  readonly id: string;
  readonly makeId: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly yearFrom: number;
  readonly yearTo: number | null;
}

export interface Vehicle {
  readonly id: string;
  readonly ownerId: string;
  readonly makeId: string;
  readonly modelId: string;
  readonly year: number;
  readonly plateEn: string | null;
  readonly plateAr: string | null;
  readonly plateNormalised: string | null;
  readonly vin: string | null;
  readonly nickname: string | null;
  readonly currentMileage: number;
}

export interface TimelineEvent {
  readonly id: string;
  readonly vehicleId: string;
  readonly eventType: TimelineEventType;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly mileage: number | null;
  readonly provenance: Provenance;
  readonly summaryAr: string;
  readonly summaryEn: string;
}

export interface Profile {
  readonly id: string;
  readonly fullName: string;
  /** Null for guests and email-only users — migration 0039. */
  readonly phone: string | null;
  readonly email: string | null;
  readonly isGuest: boolean;
  readonly preferredLocale: 'ar' | 'en';
}

export interface NewVehicleInput {
  readonly makeId: string;
  readonly modelId: string;
  readonly year: number;
  readonly plate?: string | undefined;
  readonly nickname?: string | undefined;
  readonly currentMileage?: number | undefined;
}

// ---------------------------------------------------------------------------
// Phase 3 — on-demand emergency orders
// ---------------------------------------------------------------------------

export type ServiceCategory = 'emergency' | 'periodic' | 'inspection' | 'wash' | 'bodywork';

export interface Service {
  readonly id: string;
  readonly category: ServiceCategory;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly descriptionAr: string | null;
  readonly icon: string | null;
  /** CLAUDE.md §2.5: never a float — see @habba/core's money module (ADR-0007). */
  readonly basePrice: SarAmount;
  readonly requiresVehicle: boolean;
}

export interface NewEmergencyOrderInput {
  readonly serviceId: string;
  readonly lon: number;
  readonly lat: number;
  readonly vehicleId?: string | undefined;
  readonly addressAr?: string | undefined;
  readonly problem?: string | undefined;
  readonly mileage?: number | undefined;
}

/**
 * A predictive maintenance alert (migration 0028).
 *
 * §1.4 — the moat's fourth claim: mileage plus service history turns one-off
 * emergency users into recurring ones. The message is stored rather than
 * rebuilt on read so the owner can be shown exactly what they were told, which
 * matters when the claim is "your timing belt is due in ~1,400 km".
 */
export type AlertConfidence = 'estimated' | 'measured' | 'overdue';

export interface MaintenanceAlert {
  readonly id: string;
  readonly vehicleId: string;
  readonly serviceId: string;
  readonly messageAr: string;
  readonly messageEn: string;
  readonly dueAtKm: number | null;
  readonly estimatedKm: number | null;
  readonly confidence: AlertConfidence;
}

/** One row in the customer's order history. */
export interface OrderSummary {
  readonly id: string;
  readonly status: OrderStatus;
  readonly serviceNameAr: string;
  readonly totalAmount: SarAmount | null;
  readonly createdAt: string;
}

/** A provider's public-facing card — never the KYC columns behind it (0037). */
export interface ProviderSummary {
  readonly id: string;
  readonly businessNameAr: string;
  readonly ratingAvg: number;
  readonly ratingCount: number;
}

/**
 * A photo the technician captured on the job. Stored on `orders.completion_media`
 * since migration 0032, which makes it mandatory before a job can be handed
 * back for approval — §11: "without them the moat is empty."
 */
export interface CompletionMedia {
  readonly url: string;
  readonly kind: 'before' | 'after' | 'part';
  readonly caption?: string | undefined;
}

export interface Order {
  readonly id: string;
  readonly status: OrderStatus;
  readonly fulfilmentMode: FulfilmentMode;
  readonly vehicleId: string | null;
  readonly serviceId: string;
  readonly providerId: string | null;
  readonly serviceAddressAr: string | null;
  readonly problemDescription: string | null;
  readonly quotedAmount: SarAmount | null;
  readonly partsAmount: SarAmount | null;
  readonly labourAmount: SarAmount | null;
  readonly vatAmount: SarAmount | null;
  readonly totalAmount: SarAmount | null;
  readonly escrowStatus: EscrowStatus;
  readonly completionMedia: readonly CompletionMedia[];
}

export type EscrowStatus = 'none' | 'authorised' | 'captured' | 'refunded';

export interface OrderPart {
  readonly id: string;
  readonly orderId: string;
  readonly nameAr: string;
  readonly partNumber: string | null;
  readonly isOem: boolean;
  readonly quantity: number;
  readonly unitPrice: SarAmount;
  readonly warrantyDays: number | null;
  readonly approvedByCustomer: boolean;
}

/**
 * Dispatch telemetry — the live numbers screen 05 of the design shows while a
 * request is out for matching.
 *
 * Every field is optional and none of it is ever computed on the client
 * (CLAUDE.md §2.2). The design's stated intent for this screen is "لا دوّارة" —
 * show real figures instead of a meaningless spinner — so the honest failure
 * mode when the server does not supply a field is to omit that row, never to
 * invent a number. The screens are built to read correctly with all of this
 * absent, which is the current state until the matching service publishes it.
 */
export interface DispatchTelemetry {
  /** Providers the matcher has actually reached. */
  readonly contactedCount?: number | undefined;
  readonly reviewingCount?: number | undefined;
  readonly respondingCount?: number | undefined;
  readonly busyCount?: number | undefined;
  /** Current search radius in kilometres, as widened by the matcher. */
  readonly radiusKm?: number | undefined;
  /** Rolling median match time for this area, in seconds. */
  readonly areaMedianSeconds?: number | undefined;
  readonly log?: readonly DispatchLogEntry[] | undefined;
}

export interface DispatchLogEntry {
  readonly id: string;
  readonly kind: 'submitted' | 'radius_expanded' | 'providers_notified';
  readonly occurredAt: string;
  readonly radiusKm?: number | undefined;
  readonly providerCount?: number | undefined;
}

/**
 * Live job figures. Same rule as DispatchTelemetry: server-supplied or absent.
 * An ETA invented on the device is worse than no ETA — it is a promise the
 * system has not made.
 */
export interface JobProgress {
  readonly etaMinutes?: number | undefined;
  readonly distanceKm?: number | undefined;
  /** 0–1 within the current stage; drives the partial fill on ProgressStages. */
  readonly stageProgress?: number | undefined;
  /**
   * Handover verification code. Server-only by design — it exists to stop a
   * vehicle being released to the wrong person, so a client-generated value
   * would defeat the entire control. Rendered only when present.
   */
  readonly handoverCode?: string | undefined;
  readonly lastUpdateAt?: string | undefined;
}

export interface NewRatingInput {
  readonly orderId: string;
  readonly providerId: string;
  readonly stars: number;
  readonly tags?: readonly string[] | undefined;
  readonly comment?: string | undefined;
}

// Re-exported here (not just from @habba/core) so every screen imports domain
// types from one place — data/types.ts — rather than mixing import sources.
export type { FulfilmentMode, OrderStatus };
