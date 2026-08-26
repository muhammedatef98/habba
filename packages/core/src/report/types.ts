/**
 * تقرير هبّة payload — the shape `generate_habba_report` produces.
 *
 * Shared between the database (which builds it), the app (which shares it) and
 * the public page (which renders it). Kept in @habba/core so all three agree
 * on one definition rather than three drifting ones.
 */

export type ReportProvenance =
  'self_reported' | 'self_documented' | 'habba_verified' | 'third_party';

export interface ReportVehicle {
  readonly make_ar: string;
  readonly make_en: string;
  readonly model_ar: string;
  readonly model_en: string;
  readonly year: number;
  readonly plate: string | null;
  readonly vin: string | null;
  readonly colour: string | null;
  readonly current_mileage: number;
}

export interface ReportCoverage {
  readonly total: number;
  readonly habba_verified: number;
  readonly self_documented: number;
  readonly self_reported: number;
  readonly third_party: number;
}

export interface ReportEvent {
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly event_type: string;
  readonly provenance: ReportProvenance;
  readonly summary_ar: string;
  readonly summary_en: string;
  readonly mileage: number | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly attachment_count: number;
}

export interface ReportMileagePoint {
  readonly occurred_at: string;
  readonly mileage: number;
}

export interface HabbaReport {
  readonly report_version: number;
  readonly generated_at: string;
  readonly vehicle: ReportVehicle;
  readonly ownership: { readonly months_on_habba: number };
  readonly chain: { readonly is_valid: boolean; readonly length: number };
  readonly coverage: ReportCoverage;
  readonly mileage_history: readonly ReportMileagePoint[];
  readonly events: readonly ReportEvent[];
}

/**
 * Share of the history Habba itself produced, 0–1.
 *
 * This is the number the report leads with, and the reason it is honest to
 * lead with it: it is simultaneously the buyer's confidence signal and the
 * owner's reason to route the next service through Habba. See ADR-0005.
 */
export function verifiedRatio(coverage: ReportCoverage): number {
  if (coverage.total === 0) return 0;
  return coverage.habba_verified / coverage.total;
}

export function isVerifiedEntry(provenance: ReportProvenance): boolean {
  return provenance === 'habba_verified';
}
