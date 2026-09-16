import { describe, expect, test } from 'vitest';
import { SLOT_FORM_DEFAULTS, validateSlotForm } from './schedule-form.js';

const valid = SLOT_FORM_DEFAULTS;

describe('the default form publishes a normal working week', () => {
  test('08:00–20:00, hourly, one car, seven days', () => {
    expect(validateSlotForm(valid).ok).toBe(true);
  });
});

describe('a working day has to be a working day', () => {
  test('ending before it starts is refused', () => {
    const result = validateSlotForm({ ...valid, startHour: '18', endHour: '9' });
    expect(result.ok).toBe(false);
    expect(result.hours).toBe('schedule.errors.hours');
  });

  test('a zero-length day is refused', () => {
    expect(validateSlotForm({ ...valid, startHour: '8', endHour: '8' }).ok).toBe(false);
  });

  test('round the clock is allowed — some workshops are', () => {
    expect(validateSlotForm({ ...valid, startHour: '0', endHour: '24' }).ok).toBe(true);
  });

  test('past midnight is not', () => {
    expect(validateSlotForm({ ...valid, endHour: '25' }).ok).toBe(false);
  });
});

describe('the appointment has to fit inside the day', () => {
  // ⚠️ The case worth having this file for. The server accepts it and returns
  // zero, which is true and useless: the workshop pressed publish, was told
  // nothing went wrong, and has an empty calendar.
  test('a four-hour day cannot hold a five-hour appointment', () => {
    const result = validateSlotForm({
      ...valid,
      startHour: '8',
      endHour: '12',
      slotMinutes: '300',
    });
    expect(result.ok).toBe(false);
    expect(result.hours).toBe('schedule.errors.tooShort');
  });

  test('an appointment exactly as long as the day is fine — it publishes one', () => {
    expect(
      validateSlotForm({ ...valid, startHour: '8', endHour: '12', slotMinutes: '240' }).ok,
    ).toBe(true);
  });

  test('a slot shorter than a quarter of an hour is refused', () => {
    const result = validateSlotForm({ ...valid, slotMinutes: '5' });
    expect(result.ok).toBe(false);
    expect(result.slotMinutes).toBe('schedule.errors.slotMinutes');
  });
});

describe('the numbers are integers, not "numbers"', () => {
  test.each(['', ' ', 'abc', '3.5', '-1', '١٢'])('%o is not a count of days', (value) => {
    const result = validateSlotForm({ ...valid, days: value });
    expect(result.ok).toBe(false);
    expect(result.days).toBe('schedule.errors.days');
  });

  test('a fractional capacity is refused rather than rounded', () => {
    // Number('1.5') is 1.5 and `>= 1`, so a bounds-only check would pass it and
    // Postgres would round or reject it out of sight.
    const result = validateSlotForm({ ...valid, capacity: '1.5' });
    expect(result.ok).toBe(false);
    expect(result.capacity).toBe('schedule.errors.capacity');
  });

  test('an empty capacity is refused, not read as zero', () => {
    // Number('') is 0, which is the classic way an empty field becomes a
    // silently valid value. `Number.isInteger(0)` is true, so only the bound
    // catches it.
    expect(validateSlotForm({ ...valid, capacity: '' }).ok).toBe(false);
  });
});

describe('the run length matches what the server will take', () => {
  test('fourteen days is the most the form offers', () => {
    expect(validateSlotForm({ ...valid, days: '14' }).ok).toBe(true);
    expect(validateSlotForm({ ...valid, days: '15' }).ok).toBe(false);
  });

  test('and it stays inside 0072’s own limit of sixty', () => {
    // If this ever stops being true the form starts producing round trips that
    // are refused, which is the situation this module exists to prevent.
    expect(Number(valid.days)).toBeLessThanOrEqual(60);
  });
});
