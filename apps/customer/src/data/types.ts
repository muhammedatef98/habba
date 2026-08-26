/**
 * Domain types for the customer app, mirroring the Phase 1 schema.
 *
 * These are hand-written for now. Once a Supabase project exists (ADR-0010),
 * they are replaced by `supabase gen types typescript`, which generates them
 * from the migrations and removes the risk of drift.
 */

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
  readonly phone: string;
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
