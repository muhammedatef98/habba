/**
 * The inspection loop across the seam, against the in-memory repositories.
 *
 * `inspection.integration.test.ts` proves the same journey in SQL over real
 * HTTP. This proves the half that suite cannot reach: that the two in-memory
 * repositories the dev build runs on agree with each other and with the
 * server's rules, so a screen built against them is not built against a
 * fiction.
 *
 * It asserts the things a stub could get wrong in a way that would teach the
 * UI a rule production does not have — a score the client could name, a report
 * that converts twice, a VIN that forks a car's history — and nothing about
 * RLS, which the dev build has no way to stand in for.
 *
 * It lives on the provider side because it drives both actors, and §5.1.5
 * allows `provider/**` to reach `shared/**` but never the reverse.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { recommendationFor, scoreInspection, type InspectionResults } from '@habba/core';
import {
  DevInspectionStore,
  type InspectionStore,
} from '@/features/shared/data/dev-inspection-store.js';
import { DEV_INSPECTION_SECTIONS } from '@/features/shared/data/dev-inspection-template.js';
import { InMemoryRepository } from '@/features/shared/data/repository.js';
import { InMemoryProviderRepository } from './provider-repository.js';

const ORDER_ID = 'dev-open-2';
const SUBJECT_VIN = '5HGBH41JXMN109186';

/** Every item `pass`, the baseline a realistic car is perturbed from. */
function allPass(): InspectionResults {
  const results: Record<string, Record<string, { rating: 'pass' }>> = {};
  for (const section of DEV_INSPECTION_SECTIONS) {
    results[section.key] = {};
    for (const item of section.items) {
      results[section.key]![item.key] = { rating: 'pass' };
    }
  }
  return results;
}

function rate(
  base: InspectionResults,
  sectionKey: string,
  itemKey: string,
  rating: 'pass' | 'attention' | 'fail' | 'na',
  note?: string,
): InspectionResults {
  return {
    ...base,
    [sectionKey]: {
      ...base[sectionKey],
      [itemKey]: note === undefined ? { rating } : { rating, note },
    },
  };
}

describe('inspection, end to end in the dev build', () => {
  let store: InspectionStore;
  let customer: InMemoryRepository;
  let inspector: InMemoryProviderRepository;

  beforeEach(async () => {
    // One store, two repositories — which is what the two actors share in
    // production: a single `inspection_reports` row.
    store = new DevInspectionStore();
    customer = new InMemoryRepository(store);
    inspector = new InMemoryProviderRepository(store);

    await customer.upsertProfile({
      fullName: 'مشتري السيارة',
      phone: '+966501234567',
      email: null,
      isGuest: false,
      preferredLocale: 'ar',
    });

    await inspector.setOnline(true);
    await inspector.acceptJob(ORDER_ID);
  });

  test('a pre-purchase job carries no vehicle, so the form asks for one', async () => {
    const form = await inspector.getInspectionForm(ORDER_ID);

    expect(form).not.toBeNull();
    expect(form?.subjectRequired).toBe(true);
    expect(form?.filedReportId).toBeNull();
    expect(form?.templateKey).toBe('pre_purchase_v1');
    // The real form, not a three-item stand-in: most of what is hard about
    // the capture screen only appears at this size.
    expect(form?.sections).toHaveLength(11);
  });

  test('a job that is not an inspection has no form at all', async () => {
    await inspector.acceptJob('dev-open-1');
    expect(await inspector.getInspectionForm('dev-open-1')).toBeNull();
  });

  test('an incomplete report is refused, and says what is missing', async () => {
    const partial = rate(allPass(), 'obd', 'stored_codes', 'na');
    delete (partial as Record<string, Record<string, unknown>>)['history']!['accident_evidence'];

    await expect(
      inspector.submitInspection({
        orderId: ORDER_ID,
        templateKey: 'pre_purchase_v1',
        results: partial,
        subject: { vin: SUBJECT_VIN },
      }),
    ).rejects.toThrow(/incomplete/i);
  });

  test('a report on a car nobody owns must identify the car', async () => {
    // Without this the report is an unattributable score. The server refuses
    // it (0026); a stub that accepted it would let the capture screen ship
    // with the subject fields optional.
    await expect(
      inspector.submitInspection({
        orderId: ORDER_ID,
        templateKey: 'pre_purchase_v1',
        results: allPass(),
        subject: { makeAr: 'تويوتا' },
      }),
    ).rejects.toThrow(/VIN or plate/i);
  });

  test('the score is derived, not supplied — and a critical fault caps it', async () => {
    const results = rate(
      allPass(),
      'history',
      'accident_evidence',
      'fail',
      'إصلاح وإعادة دهان في الرفرف الأمامي الأيسر',
    );

    await inspector.submitInspection({
      orderId: ORDER_ID,
      templateKey: 'pre_purchase_v1',
      results,
      subject: { vin: SUBJECT_VIN, plate: 'ا ب ح ٣٣٣٣', year: 2018, mileage: 120000 },
    });

    const outcome = await customer.getInspectionForOrder(ORDER_ID);
    expect(outcome).not.toBeNull();

    // Confirmed accident repair caps the score and forces `avoid`, however
    // sound the other forty-two items are. Weighted averaging alone put this
    // car at 92% and `buy`.
    expect(outcome?.report.overall_score).toBeLessThanOrEqual(45);
    expect(outcome?.report.recommendation).toBe('avoid');

    // And it is exactly what the mirror the inspector watched would say, so
    // the number never moves between filing and reading.
    expect(outcome?.report.overall_score).toBe(scoreInspection(DEV_INSPECTION_SECTIONS, results));
    expect(outcome?.report.recommendation).toBe(
      recommendationFor(scoreInspection(DEV_INSPECTION_SECTIONS, results)),
    );
  });

  test('a filed report closes the form rather than inviting a second one', async () => {
    await inspector.submitInspection({
      orderId: ORDER_ID,
      templateKey: 'pre_purchase_v1',
      results: allPass(),
      subject: { vin: SUBJECT_VIN },
    });

    const form = await inspector.getInspectionForm(ORDER_ID);
    expect(form?.filedReportId).not.toBeNull();

    await expect(
      inspector.submitInspection({
        orderId: ORDER_ID,
        templateKey: 'pre_purchase_v1',
        results: allPass(),
        subject: { vin: SUBJECT_VIN },
      }),
    ).rejects.toThrow(/already been filed/i);
  });

  test('the report the buyer reads carries no trace of who bought it', async () => {
    await inspector.submitInspection({
      orderId: ORDER_ID,
      templateKey: 'pre_purchase_v1',
      results: allPass(),
      subject: { vin: SUBJECT_VIN },
    });

    const outcome = await customer.getInspectionForOrder(ORDER_ID);

    // The report is about the CAR. A seller forwarding it must not be
    // forwarding the name of whoever paid for the inspection (§7.3).
    const wire = JSON.stringify(outcome?.report);
    expect(wire).not.toContain('مشتري السيارة');
    expect(wire).not.toContain('+966501234567');
  });

  test('THE acceptance: the buyer claims the car and the logbook opens with the inspection', async () => {
    const results = rate(allPass(), 'tyres', 'tread', 'attention', 'النقشة قاربت الحد');

    await inspector.submitInspection({
      orderId: ORDER_ID,
      templateKey: 'pre_purchase_v1',
      results,
      subject: { vin: SUBJECT_VIN, plate: 'ا ب ح ٣٣٣٣', year: 2018, mileage: 120000 },
    });

    const outcome = await customer.getInspectionForOrder(ORDER_ID);
    const vehicleId = await customer.convertInspectionToVehicle({
      reportId: outcome!.reportId,
      makeId: 'make-toyota',
      modelId: 'm-camry',
      nickname: 'كامري الجديدة',
    });

    const vehicle = await customer.getVehicle(vehicleId);
    expect(vehicle?.vin).toBe(SUBJECT_VIN);
    expect(vehicle?.year).toBe(2018);
    // The odometer comes off the report rather than being asked for again —
    // the inspector read it, and the buyer has no better answer.
    expect(vehicle?.currentMileage).toBe(120000);

    // The acquisition loop, working: a brand-new logbook that is not empty.
    const timeline = await customer.listTimeline(vehicleId);
    const inspectionEvent = timeline.find((event) => event.eventType === 'inspection_completed');

    expect(inspectionEvent).toBeDefined();
    // Habba dispatched the inspector and holds the report, so this is a system
    // fact — never an owner's claim (ADR-0005).
    expect(inspectionEvent?.provenance).toBe('habba_verified');
    expect(inspectionEvent?.details['inspection_score']).toBe(outcome?.report.overall_score);
    expect(timeline.some((event) => event.eventType === 'vehicle_registered')).toBe(true);
  });

  test('a report is claimed once, and the offer disappears afterwards', async () => {
    await inspector.submitInspection({
      orderId: ORDER_ID,
      templateKey: 'pre_purchase_v1',
      results: allPass(),
      subject: { vin: SUBJECT_VIN },
    });

    const outcome = await customer.getInspectionForOrder(ORDER_ID);
    await customer.convertInspectionToVehicle({
      reportId: outcome!.reportId,
      makeId: 'make-toyota',
      modelId: 'm-camry',
    });

    // The screen hides «هذه سيارتي الآن» on exactly this fact.
    const afterwards = await customer.getInspectionForOrder(ORDER_ID);
    expect(afterwards?.vehicleId).not.toBeNull();

    await expect(
      customer.convertInspectionToVehicle({
        reportId: outcome!.reportId,
        makeId: 'make-toyota',
        modelId: 'm-camry',
      }),
    ).rejects.toThrow(/already/i);
  });

  test('a VIN that already has a logbook is refused, not forked', async () => {
    // The one thing the whole product exists to prevent: two records for one
    // car, each holding half its history. The remedy is ownership transfer,
    // and the message text is what the screen matches on to offer it.
    await inspector.submitInspection({
      orderId: ORDER_ID,
      templateKey: 'pre_purchase_v1',
      results: allPass(),
      subject: { vin: SUBJECT_VIN },
    });

    const first = await customer.getInspectionForOrder(ORDER_ID);
    await customer.convertInspectionToVehicle({
      reportId: first!.reportId,
      makeId: 'make-toyota',
      modelId: 'm-camry',
    });

    // A second inspection of the same car, on a different order — the buyer
    // who lost the auction, or the same car back on the market a year later.
    const secondOrder = 'dev-open-3';
    store.file({
      orderId: secondOrder,
      results: allPass(),
      subject: { vin: SUBJECT_VIN },
      vehicleId: null,
    });
    const second = await customer.getInspectionForOrder(secondOrder);

    await expect(
      customer.convertInspectionToVehicle({
        reportId: second!.reportId,
        makeId: 'make-toyota',
        modelId: 'm-camry',
      }),
    ).rejects.toThrow(/already has a Habba logbook/i);
  });
});
