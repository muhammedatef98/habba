import { describe, expect, it } from 'vitest';
import { daysFromToday, groupSlotsByDay } from './slot-days.js';
import type { AppointmentSlot } from '@/features/shared/data/types';

function slot(startsAt: string): AppointmentSlot {
  return {
    id: `slot-${startsAt}`,
    providerId: 'prov-1',
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(),
    remaining: 1,
  };
}

describe('groupSlotsByDay', () => {
  it('groups by the local calendar day, not by the UTC one', () => {
    // 2026-03-10 01:00 local is still the 10th locally whatever the offset,
    // because the fixture is constructed in local time.
    const days = groupSlotsByDay([
      slot('2026-03-10T09:00:00'),
      slot('2026-03-10T18:00:00'),
      slot('2026-03-11T09:00:00'),
    ]);

    expect(days).toHaveLength(2);
    expect(days[0]?.slots).toHaveLength(2);
    expect(days[1]?.slots).toHaveLength(1);
  });

  it('returns days in order and slots within a day in order', () => {
    const days = groupSlotsByDay([
      slot('2026-03-11T09:00:00'),
      slot('2026-03-10T18:00:00'),
      slot('2026-03-10T09:00:00'),
    ]);

    expect(days.map((day) => day.key)).toEqual(['2026-03-10', '2026-03-11']);
    expect(days[0]?.slots[0]?.startsAt).toBe(new Date('2026-03-10T09:00:00').toISOString());
  });

  it('has nothing to group when there are no slots', () => {
    expect(groupSlotsByDay([])).toEqual([]);
  });
});

describe('daysFromToday', () => {
  const now = new Date(2026, 2, 10, 23, 30);

  it('counts calendar days, so 23:30 tonight to 00:30 tomorrow is one day', () => {
    expect(daysFromToday(new Date(2026, 2, 11, 0, 30), now)).toBe(1);
  });

  it('is zero for later today', () => {
    expect(daysFromToday(new Date(2026, 2, 10, 8, 0), now)).toBe(0);
  });

  it('counts further days', () => {
    expect(daysFromToday(new Date(2026, 2, 17, 9, 0), now)).toBe(7);
  });
});
