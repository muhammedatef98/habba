/**
 * صحة السيارة and تكلفة الملكية — the shapes the server returns (0097), and
 * the scoring rule written once more in TypeScript.
 *
 * The server decides (§2.2): `vehicle_health` and `vehicle_cost_summary` are
 * what the app shows against a real project. `scoreVehicleHealth` exists for
 * the in-memory repository, which has no database to ask, and its tests pin
 * the same numbers 0097's suite does — so the dev build cannot quietly teach
 * anyone a different rule from the one production applies.
 */

export type HealthGrade = 'excellent' | 'good' | 'fair' | 'attention' | 'unknown';

export type HealthFactorKey =
  | 'care_overdue'
  | 'care_snoozed'
  | 'care_soon'
  | 'documents_expired'
  | 'documents_expiring'
  | 'no_recent_service'
  | 'undocumented'
  | 'warranty_active';

export interface HealthFactor {
  readonly key: HealthFactorKey;
  readonly count: number;
  /** Points this factor moved the score by: negative takes away, positive adds. */
  readonly impact: number;
}

export interface VehicleHealth {
  /** 0–100, or null when there is nothing recorded to judge. */
  readonly score: number | null;
  readonly grade: HealthGrade;
  readonly factors: readonly HealthFactor[];
}

export interface HealthInputs {
  /** Care items tracked at all. */
  readonly careItems: number;
  readonly careOverdue: number;
  /** Past due but deferred by the owner. Counted instead of overdue. */
  readonly careSnoozed: number;
  readonly careSoon: number;
  readonly documents: number;
  readonly documentsExpired: number;
  readonly documentsExpiring: number;
  readonly services: number;
  /** Services with evidence — anything but self-reported. */
  readonly documentedServices: number;
  readonly monthsSinceLastService: number | null;
  readonly warrantyActive: boolean;
}

export function gradeFor(score: number): Exclude<HealthGrade, 'unknown'> {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'attention';
}

/** Mirrors `public.vehicle_health` (0097) step for step. */
export function scoreVehicleHealth(input: HealthInputs): VehicleHealth {
  if (input.careItems === 0 && input.documents === 0 && input.services === 0) {
    return { score: null, grade: 'unknown', factors: [] };
  }

  const factors: HealthFactor[] = [];
  const add = (key: HealthFactorKey, count: number, impact: number) => {
    if (count > 0 && impact !== 0) factors.push({ key, count, impact });
  };

  add('care_overdue', input.careOverdue, -Math.min(input.careOverdue * 15, 45));
  add('care_snoozed', input.careSnoozed, -Math.min(input.careSnoozed * 8, 24));
  add('care_soon', input.careSoon, -Math.min(input.careSoon * 5, 15));
  add('documents_expired', input.documentsExpired, -Math.min(input.documentsExpired * 15, 30));
  add('documents_expiring', input.documentsExpiring, -Math.min(input.documentsExpiring * 5, 10));

  if (
    input.services > 0 &&
    input.monthsSinceLastService !== null &&
    input.monthsSinceLastService >= 18
  ) {
    add('no_recent_service', 1, -10);
  }

  if (input.services > 0 && input.documentedServices < input.services) {
    const undocumented = input.services - input.documentedServices;
    add('undocumented', undocumented, -Math.round((10 * undocumented) / input.services));
  }

  if (input.warrantyActive) add('warranty_active', 1, 5);

  const raw = 100 + factors.reduce((sum, factor) => sum + factor.impact, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, grade: gradeFor(score), factors };
}

export type CostCategory =
  'maintenance' | 'emergency' | 'inspection' | 'wash' | 'bodywork' | 'other';

export interface VehicleCostSummary {
  /** VAT-inclusive, 2dp strings, as the server sends money (ADR-0007). */
  readonly total: string;
  readonly last12Months: string;
  readonly thisYear: string;
  readonly entries: number;
  /** Twelve months, oldest first, `YYYY-MM`. */
  readonly months: readonly { readonly month: string; readonly amount: string }[];
  /** The last 12 months, largest first. */
  readonly categories: readonly { readonly category: CostCategory; readonly amount: string }[];
  readonly km12Months: number;
  /** Null under 500 km, where the ratio would be noise. */
  readonly per1000Km: string | null;
}

/** Mirrors `public.cost_bucket` (0097). */
export function costCategoryFor(
  serviceCategory: string | null,
  serviceType: string | null,
): CostCategory {
  if (serviceCategory === 'emergency') return 'emergency';
  if (serviceCategory === 'inspection') return 'inspection';
  if (serviceCategory === 'wash') return 'wash';
  if (serviceCategory === 'bodywork' || serviceType === 'bodywork') return 'bodywork';
  if (
    serviceCategory === 'periodic' ||
    (serviceType !== null &&
      ['oil_change', 'brakes', 'battery', 'tyres', 'air_filter', 'ac_service'].includes(
        serviceType,
      ))
  ) {
    return 'maintenance';
  }
  return 'other';
}

export interface CostLine {
  /** Riyadh calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  /** Integer halalas: summed exactly, formatted once. */
  readonly halalas: number;
  readonly category: CostCategory;
}

function fixed(halalas: number): string {
  return (halalas / 100).toFixed(2);
}

/** Today in Riyadh (UTC+3, no daylight saving), `YYYY-MM-DD`. */
export function riyadhDay(at: Date): string {
  return new Date(at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Mirrors `public.vehicle_cost_summary` (0097) over lines the caller already
 * has. `kmOver12Months` is the odometer's movement across the same window.
 */
export function summariseCosts(
  lines: readonly CostLine[],
  today: string,
  kmOver12Months: number,
): VehicleCostSummary {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const months: string[] = [];
  for (let back = 11; back >= 0; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    months.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  const windowStart = `${months[0]}-01`;
  const yearStart = `${year}-01-01`;

  const valid = lines.filter((line) => line.halalas > 0);
  const inWindow = valid.filter((line) => line.day >= windowStart);
  const sum = (rows: readonly CostLine[]) => rows.reduce((total, row) => total + row.halalas, 0);

  const byCategory = new Map<CostCategory, number>();
  for (const line of inWindow) {
    byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + line.halalas);
  }

  const last12 = sum(inWindow);
  return {
    total: fixed(sum(valid)),
    last12Months: fixed(last12),
    thisYear: fixed(sum(valid.filter((line) => line.day >= yearStart))),
    entries: valid.length,
    months: months.map((key) => ({
      month: key,
      amount: fixed(sum(inWindow.filter((line) => line.day.startsWith(key)))),
    })),
    categories: [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, halalas]) => ({ category, amount: fixed(halalas) })),
    km12Months: kmOver12Months,
    per1000Km:
      kmOver12Months >= 500 && last12 > 0
        ? fixed(Math.round((last12 * 1000) / kmOver12Months))
        : null,
  };
}
