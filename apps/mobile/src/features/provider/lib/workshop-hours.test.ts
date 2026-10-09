import { describe, expect, it } from 'vitest';
import { hoursFromWindow, windowFromHours } from './workshop-hours';

describe('workshop opening hours', () => {
  it('writes one window on the chosen days, the rest closed', () => {
    expect(hoursFromWindow(['sun', 'thu'], 8 * 60, 20 * 60 + 30)).toEqual({
      sun: [['08:00', '20:30']],
      thu: [['08:00', '20:30']],
    });
  });

  it('reads back what it wrote', () => {
    const hours = hoursFromWindow(['sat', 'sun', 'mon'], 9 * 60, 22 * 60);
    expect(windowFromHours(hours)).toEqual({
      days: ['sun', 'mon', 'sat'],
      startMinute: 540,
      endMinute: 1320,
    });
  });

  it('reads nothing from empty or broken hours', () => {
    expect(windowFromHours({})).toBeNull();
    expect(windowFromHours({ sun: [['20:00', '08:00']] })).toBeNull();
    expect(windowFromHours({ sun: [['eight', 'late']] })).toBeNull();
  });
});
