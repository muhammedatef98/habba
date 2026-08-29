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

/** A provider's public-facing card — never the KYC columns behind it (0037). */
export interface ProviderSummary {
  readonly id: string;
  readonly businessNameAr: string;
  readonly ratingAvg: number;
  readonly ratingCount: number;
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
