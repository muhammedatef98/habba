import { describe, expect, test } from 'vitest';
import type { MaintenanceItem, VehicleDocument } from '@/features/shared/data/types';
import {
  byUrgency,
  documentLine,
  isSnoozed,
  maintenanceLine,
  CARE_LEAD_DAYS,
} from './care-language.js';

const NOW = Date.UTC(2026, 8, 11, 9, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function item(overrides: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    itemId: 'item-1',
    itemType: 'engine_oil',
    nameAr: 'زيت المحرك',
    nameEn: 'Engine oil',
    serviceId: 'svc-1',
    intervalKm: 7000,
    intervalMonths: 6,
    lastDoneKm: 76000,
    lastDoneAt: new Date(NOW - 60 * DAY).toISOString(),
    dueAtKm: 83000,
    dueAtDate: null,
    kmRemaining: 4000,
    daysRemaining: 120,
    dueByKm: false,
    dueByDate: false,
    isDue: false,
    isApproaching: false,
    kmIsEstimated: true,
    snoozedUntil: null,
    lastReadingAt: new Date(NOW - 3 * DAY).toISOString(),
    ...overrides,
  };
}

function doc(overrides: Partial<VehicleDocument> = {}): VehicleDocument {
  return {
    documentId: 'doc-1',
    docType: 'insurance',
    expiresAt: '2026-09-16',
    daysRemaining: 5,
    isExpired: false,
    isExpiring: true,
    ...overrides,
  };
}

describe('maintenanceLine — ADR-0022, what the section may claim', () => {
  test('a distance-based item is NEVER stated as certain, however overdue', () => {
    // The single assertion this module exists for. The app cannot see the
    // odometer between readings, so «موعد الزيت النهارده» is a claim the data
    // does not support — and the first false alarm costs the section the
    // credibility §1 rests on.
    const overdueByKm = maintenanceLine(item({ dueByKm: true, isDue: true, kmRemaining: -900 }));
    expect(overdueByKm.certain).toBe(false);
    expect(overdueByKm.key).toBe('care.item.likelyDue');
  });

  test('and neither is one that is merely approaching on distance', () => {
    const soon = maintenanceLine(item({ kmRemaining: 200, daysRemaining: 300 }));
    expect(soon.certain).toBe(false);
    expect(soon.key).toBe('care.item.afterKm');
    expect(soon.urgency).toBe('soon');
  });

  test('a date-based item IS certain, because the arithmetic is on known dates', () => {
    // Both ends are known exactly: when it was last done, and how many months
    // the interval runs. Hedging this would be vague where we can be exact.
    const dueByDate = maintenanceLine(
      item({ dueByDate: true, isDue: true, daysRemaining: -12, kmRemaining: 4000 }),
    );
    expect(dueByDate.certain).toBe(true);
    expect(dueByDate.key).toBe('care.item.dueNow');
  });

  test('the date axis wins when both are due, because it is the one we can state', () => {
    const both = maintenanceLine(item({ dueByDate: true, dueByKm: true, isDue: true }));
    expect(both.key).toBe('care.item.dueNow');
    expect(both.certain).toBe(true);
  });

  test('an idle car due only on time still produces a due line', () => {
    // The whole reason the month axis exists: a car that has not moved has
    // travelled no distance and still needs its oil changed.
    const idle = maintenanceLine(
      item({ dueByDate: true, isDue: true, kmRemaining: 6800, daysRemaining: -3 }),
    );
    expect(idle.urgency).toBe('overdue');
  });

  test('a date inside the lead window reads as a count of days, not a hedge', () => {
    const line = maintenanceLine(item({ daysRemaining: CARE_LEAD_DAYS - 1, kmRemaining: 5000 }));
    expect(line.key).toBe('care.item.inDays');
    expect(line.certain).toBe(true);
    expect(line.values['days']).toBe(CARE_LEAD_DAYS - 1);
  });

  test('an item we were never told about says so, rather than saying it is fine', () => {
    // "Fine" is a claim. We have simply never been told when this was done,
    // and the copy behind this key asks.
    const line = maintenanceLine(
      item({
        lastDoneKm: null,
        lastDoneAt: null,
        dueAtKm: null,
        kmRemaining: null,
        daysRemaining: null,
      }),
    );
    expect(line.key).toBe('care.item.unknown');
    expect(line.certain).toBe(false);
  });
});

describe('documentLine — the certain half of القادم', () => {
  test('every document line is certain, on every branch', () => {
    // Not an oversight. An expiry date was read off a document; the only
    // arithmetic is a subtraction.
    for (const d of [
      doc(),
      doc({ daysRemaining: 0 }),
      doc({ daysRemaining: -3, isExpired: true }),
      doc({ daysRemaining: 200, isExpiring: false }),
    ]) {
      expect(documentLine(d).certain).toBe(true);
    }
  });

  test('an expired document counts the days it has been expired, as a positive', () => {
    const line = documentLine(doc({ daysRemaining: -3, isExpired: true }));
    expect(line.key).toBe('care.doc.expired');
    expect(line.values['days']).toBe(3);
    expect(line.urgency).toBe('overdue');
  });

  test('expiring today is its own sentence', () => {
    expect(documentLine(doc({ daysRemaining: 0 })).key).toBe('care.doc.today');
  });
});

describe('isSnoozed', () => {
  test('a snooze in the future silences the notification, not the row', () => {
    expect(isSnoozed(item({ snoozedUntil: new Date(NOW + 5 * DAY).toISOString() }), NOW)).toBe(
      true,
    );
  });

  test('a lapsed snooze is no snooze', () => {
    expect(isSnoozed(item({ snoozedUntil: new Date(NOW - DAY).toISOString() }), NOW)).toBe(false);
  });

  test('an unparseable timestamp is not treated as an indefinite silence', () => {
    // A NaN comparison is false either way; asserted so that the answer is the
    // safe one on purpose rather than by accident.
    expect(isSnoozed(item({ snoozedUntil: 'not a date' }), NOW)).toBe(false);
  });
});

describe('byUrgency', () => {
  test('overdue sorts before soon, before scheduled, before unknown', () => {
    const lines = [
      maintenanceLine(
        item({ lastDoneKm: null, lastDoneAt: null, kmRemaining: null, daysRemaining: null }),
      ),
      maintenanceLine(item({ kmRemaining: 5000, daysRemaining: 300 })),
      maintenanceLine(item({ dueByKm: true, isDue: true })),
      documentLine(doc({ daysRemaining: 5 })),
    ];

    expect([...lines].sort(byUrgency).map((line) => line.urgency)).toEqual([
      'overdue',
      'soon',
      'scheduled',
      'unknown',
    ]);
  });
});
