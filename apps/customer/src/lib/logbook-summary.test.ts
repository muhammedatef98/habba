import { describe, expect, it } from 'vitest';
import { summariseLogbook } from './logbook-summary.js';
import type { TimelineEvent, TimelineEventType } from '@/data/types';

function event(eventType: TimelineEventType, occurredAt: string): TimelineEvent {
  return {
    id: `${eventType}-${occurredAt}`,
    vehicleId: 'veh-1',
    eventType,
    occurredAt,
    recordedAt: occurredAt,
    mileage: null,
    provenance: 'self_reported',
    summaryAr: '',
    summaryEn: '',
  };
}

describe('summariseLogbook', () => {
  it('counts every entry, not just services — the logbook’s size is the point', () => {
    const summary = summariseLogbook([
      event('vehicle_registered', '2026-01-01T00:00:00.000Z'),
      event('mileage_recorded', '2026-02-01T00:00:00.000Z'),
      event('service_completed', '2026-03-01T00:00:00.000Z'),
    ]);
    expect(summary.recordCount).toBe(3);
  });

  it('takes the newest service regardless of the order events arrive in', () => {
    const summary = summariseLogbook([
      event('service_completed', '2026-03-01T00:00:00.000Z'),
      event('parts_replaced', '2026-06-01T00:00:00.000Z'),
      event('inspection_completed', '2026-04-01T00:00:00.000Z'),
    ]);
    expect(summary.lastServiceAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('does not treat a mileage reading or a raised alert as a service', () => {
    const summary = summariseLogbook([
      event('vehicle_registered', '2026-01-01T00:00:00.000Z'),
      event('mileage_recorded', '2026-02-01T00:00:00.000Z'),
      event('alert_raised', '2026-02-02T00:00:00.000Z'),
    ]);
    expect(summary.lastServiceAt).toBeNull();
    expect(summary.recordCount).toBe(3);
  });

  it('reports an empty logbook as empty rather than as zero services ago', () => {
    expect(summariseLogbook([])).toEqual({ recordCount: 0, lastServiceAt: null });
  });
});
