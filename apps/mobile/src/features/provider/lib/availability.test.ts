import { describe, expect, it } from 'vitest';
import {
  FRIDAY,
  clampWindow,
  defaultDayKeys,
  groupByRiyadhDay,
  riyadhKey,
  slotsPerDay,
  upcomingDays,
} from './availability';

// 20:30 UTC on Thursday 8 October 2026 is 23:30 the same day in Riyadh.
const THURSDAY_EVENING = new Date('2026-10-08T20:30:00Z');
// 22:30 UTC is 01:30 Friday in Riyadh.
const AFTER_RIYADH_MIDNIGHT = new Date('2026-10-08T22:30:00Z');

describe("the technician's calendar", () => {
  it("counts days in Riyadh, not in the phone's zone", () => {
    expect(upcomingDays(1, THURSDAY_EVENING)[0]?.key).toBe('2026-10-08');
    expect(upcomingDays(1, AFTER_RIYADH_MIDNIGHT)[0]?.key).toBe('2026-10-09');
    expect(upcomingDays(1, AFTER_RIYADH_MIDNIGHT)[0]?.weekday).toBe(FRIDAY);
  });

  it('offers the coming week from tomorrow, Fridays off', () => {
    const days = upcomingDays(14, THURSDAY_EVENING);
    const chosen = defaultDayKeys(days);
    expect(chosen).toHaveLength(6);
    expect(chosen).not.toContain('2026-10-09');
    expect(chosen[0]).toBe('2026-10-10');
  });

  it('fits whole appointments into the window', () => {
    expect(slotsPerDay(9 * 60, 17 * 60, 60)).toBe(8);
    expect(slotsPerDay(9 * 60, 17 * 60, 90)).toBe(5);
    expect(slotsPerDay(17 * 60, 9 * 60, 60)).toBe(0);
  });

  it('keeps the window inside the day and at least one appointment long', () => {
    expect(clampWindow(-30, 600, 60)).toEqual({ startMinute: 0, endMinute: 600 });
    expect(clampWindow(600, 600, 60)).toEqual({ startMinute: 600, endMinute: 660 });
    expect(clampWindow(1430, 1500, 60)).toEqual({ startMinute: 1380, endMinute: 1440 });
  });

  it('groups times under their Riyadh day', () => {
    // 21:30 UTC on the 8th is 00:30 on the 9th in Riyadh.
    expect(riyadhKey('2026-10-08T21:30:00Z')).toBe('2026-10-09');
    const groups = groupByRiyadhDay([
      { startsAt: '2026-10-09T06:00:00Z' },
      { startsAt: '2026-10-08T21:30:00Z' },
      { startsAt: '2026-10-10T06:00:00Z' },
    ]);
    expect(groups.map((group) => [group.key, group.items.length])).toEqual([
      ['2026-10-09', 2],
      ['2026-10-10', 1],
    ]);
  });
});
