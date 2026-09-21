/**
 * The dev build's inspection store, shared by both in-memory repositories.
 *
 * An inspection is the one flow with two actors on the same record: the
 * inspector files it and the buyer reads it. In production they are two
 * accounts against one `inspection_reports` row; in the dev build they are two
 * repositories in one process, and if each kept its own copy the loop could
 * never be walked end to end. So the record lives here and both hold a
 * reference to it — `features/provider` and `features/shared` may both import
 * this, and `features/customer` never imports the provider's side of it
 * (§5.1.5).
 *
 * Everything the server derives is derived here too, from the same mirror the
 * screens use (`@habba/core`'s `scoreInspection`). A stub that let a caller
 * name its own score would let a screen be written against a number the client
 * chooses — and that number is what a buyer hands over money on.
 *
 * The refusals are mirrored word for word, not merely in kind: the screens
 * match on the server's message text, so a dev message that read differently
 * would send a developer down a branch production never takes.
 */

import {
  missingRequiredItems,
  recommendationFor,
  scoreInspection,
  type InspectionReport,
  type InspectionResults,
  type InspectionTemplateSection,
} from '@habba/core';
import {
  DEV_INSPECTION_SECTIONS,
  DEV_INSPECTION_TEMPLATE_KEY,
  DEV_INSPECTION_TEMPLATE_NAME_AR,
} from './dev-inspection-template.js';
import type { InspectionOutcome, InspectionSubject } from './types.js';

export interface DevFileInspectionInput {
  readonly orderId: string;
  readonly results: InspectionResults;
  readonly subject: InspectionSubject;
  /** The order's vehicle, when it has one. Decides whether a subject is required. */
  readonly vehicleId: string | null;
}

/**
 * What the two in-memory repositories need from the store. Named so they can
 * be handed a fresh one in a test without exporting a reset that production
 * code could reach for.
 */
export interface InspectionStore {
  templateKey(): string;
  templateNameAr(): string;
  sections(): readonly InspectionTemplateSection[];
  forOrder(orderId: string): InspectionOutcome | null;
  forReport(reportId: string): InspectionOutcome | null;
  file(input: DevFileInspectionInput): string;
  attachVehicle(reportId: string, vehicleId: string): InspectionOutcome;
}

export class DevInspectionStore implements InspectionStore {
  private readonly byOrderId = new Map<string, InspectionOutcome>();
  private counter = 0;

  templateKey(): string {
    return DEV_INSPECTION_TEMPLATE_KEY;
  }

  sections(): readonly InspectionTemplateSection[] {
    return DEV_INSPECTION_SECTIONS;
  }

  templateNameAr(): string {
    return DEV_INSPECTION_TEMPLATE_NAME_AR;
  }

  forOrder(orderId: string): InspectionOutcome | null {
    return this.byOrderId.get(orderId) ?? null;
  }

  forReport(reportId: string): InspectionOutcome | null {
    for (const outcome of this.byOrderId.values()) {
      if (outcome.reportId === reportId) return outcome;
    }
    return null;
  }

  /** `submit_inspection_report`, refusals and all. Returns the report id. */
  file(input: DevFileInspectionInput): string {
    // `order_id` is unique on `inspection_reports`: an inspection is filed
    // once. Re-filing would mean two scores for one job, and the second one
    // arriving after the buyer has read the first.
    if (this.byOrderId.has(input.orderId)) {
      throw new Error('That inspection has already been filed');
    }

    const missing = missingRequiredItems(DEV_INSPECTION_SECTIONS, input.results);
    if (missing.length > 0) {
      throw new Error(
        `Inspection is incomplete: ${missing.length} required item(s) unanswered ` +
          `(${missing.slice(0, 5).join(', ')})`,
      );
    }

    const hasSubject =
      (input.subject.vin ?? '').length > 0 || (input.subject.plate ?? '').length > 0;
    if (input.vehicleId === null && !hasSubject) {
      throw new Error(
        'A pre-purchase inspection must record the VIN or plate of the car inspected',
      );
    }

    const score = scoreInspection(DEV_INSPECTION_SECTIONS, input.results);

    this.counter += 1;
    const reportId = `dev-inspection-${this.counter}`;
    const completedAt = new Date().toISOString();

    const report: InspectionReport = {
      report_version: 1,
      completed_at: completedAt,
      subject: {
        ...(input.subject.vin === undefined ? {} : { vin: input.subject.vin }),
        ...(input.subject.plate === undefined ? {} : { plate: input.subject.plate }),
        ...(input.subject.makeAr === undefined ? {} : { make_ar: input.subject.makeAr }),
        ...(input.subject.modelAr === undefined ? {} : { model_ar: input.subject.modelAr }),
        ...(input.subject.year === undefined ? {} : { year: input.subject.year }),
        ...(input.subject.mileage === undefined ? {} : { mileage: input.subject.mileage }),
      },
      overall_score: score,
      recommendation: recommendationFor(score),
      template: {
        key: DEV_INSPECTION_TEMPLATE_KEY,
        name_ar: DEV_INSPECTION_TEMPLATE_NAME_AR,
        sections: DEV_INSPECTION_SECTIONS,
      },
      results: input.results,
    };

    this.byOrderId.set(input.orderId, {
      reportId,
      orderId: input.orderId,
      // A real token is 64 url-safe characters minted by the database. This
      // one only has to be unguessable-shaped enough that nothing is written
      // assuming it is short or readable.
      publicToken: `dev-insp-${reportId}-${Math.random().toString(36).slice(2, 10)}`,
      vehicleId: input.vehicleId,
      report,
    });

    return reportId;
  }

  /**
   * The vehicle side of `convert_inspection_to_vehicle`: the report may be
   * claimed once, and only while it is not already attached to a car.
   *
   * The caller creates the vehicle and writes the timeline, because that is
   * where the dev vehicle store lives. This owns only the fact that decides
   * whether the offer is still open.
   */
  attachVehicle(reportId: string, vehicleId: string): InspectionOutcome {
    const outcome = this.forReport(reportId);
    if (outcome === null) {
      throw new Error(`Inspection report ${reportId} not found`);
    }
    if (outcome.vehicleId !== null) {
      throw new Error('That inspection is already attached to a vehicle');
    }

    const attached: InspectionOutcome = { ...outcome, vehicleId };
    this.byOrderId.set(outcome.orderId, attached);
    return attached;
  }
}

export const devInspections: InspectionStore = new DevInspectionStore();
