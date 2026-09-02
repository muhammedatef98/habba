import { describe, expect, it } from 'vitest';
import { countByFilter, filterEvents } from './logbook-filter.js';
import type { TimelineEvent, TimelineEventType } from '@/data/types';

function event(eventType: TimelineEventType): TimelineEvent {
  return {
    id: eventType,
    vehicleId: 'veh-1',
    eventType,
    occurredAt: '2026-01-01T00:00:00.000Z',
    recordedAt: '2026-01-01T00:00:00.000Z',
    mileage: null,
    provenance: 'habba_verified',
    summaryAr: '',
    summaryEn: '',
  };
}

const ALL: readonly TimelineEvent[] = [
  event('vehicle_registered'),
  event('service_completed'),
  event('parts_replaced'),
  event('warranty_claimed'),
  event('inspection_completed'),
  event('mileage_recorded'),
  event('alert_raised'),
];

describe('filterEvents', () => {
  it('returns everything under "all", including events in no other bucket', () => {
    expect(filterEvents(ALL, 'all')).toHaveLength(ALL.length);
  });

  it('treats parts and warranty work as service — the customer sees one job', () => {
    const service = filterEvents(ALL, 'service').map((item) => item.eventType);
    expect(service).toEqual(['service_completed', 'parts_replaced', 'warranty_claimed']);
  });

  it('separates inspections from services', () => {
    expect(filterEvents(ALL, 'inspection').map((item) => item.eventType)).toEqual([
      'inspection_completed',
    ]);
  });

  it('keeps registration and alerts out of every narrow filter', () => {
    for (const filter of ['service', 'inspection', 'mileage'] as const) {
      const types = filterEvents(ALL, filter).map((item) => item.eventType);
      expect(types).not.toContain('vehicle_registered');
      expect(types).not.toContain('alert_raised');
    }
  });
});

describe('countByFilter', () => {
  it('counts every event under all and only bucketed ones elsewhere', () => {
    expect(countByFilter(ALL)).toEqual({ all: 7, service: 3, inspection: 1, mileage: 1 });
  });

  it('reports zeroes for an empty logbook', () => {
    expect(countByFilter([])).toEqual({ all: 0, service: 0, inspection: 0, mileage: 0 });
  });
});
