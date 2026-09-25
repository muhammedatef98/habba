import { describe, expect, test } from 'vitest';
import { changedFields, intervalToSeconds } from './audit';

describe('changedFields', () => {
  test('names the fields an update changed, from what to what', () => {
    expect(
      changedFields(
        { id: 'p1', verification_status: 'pending', updated_at: '2026-01-01' },
        { id: 'p1', verification_status: 'approved', updated_at: '2026-01-02' },
      ),
    ).toEqual([{ field: 'verification_status', from: 'pending', to: 'approved' }]);
  });

  test('an insert shows what was set, a delete what was removed', () => {
    expect(changedFields(null, { id: 'c1', name_ar: 'الخبر' })).toEqual([
      { field: 'id', from: null, to: 'c1' },
      { field: 'name_ar', from: null, to: 'الخبر' },
    ]);
    expect(changedFields({ id: 'c1' }, null)).toEqual([{ field: 'id', from: 'c1', to: null }]);
  });

  test('compares values, not references — an unchanged object is not a change', () => {
    expect(changedFields({ hours: { sun: [1, 2] } }, { hours: { sun: [1, 2] } })).toEqual([]);
  });
});

describe('intervalToSeconds', () => {
  test('reads the clock form PostgREST sends', () => {
    expect(intervalToSeconds('00:08:32')).toBe(512);
  });

  test('and the day prefix once an order has been stuck that long', () => {
    expect(intervalToSeconds('1 day 02:00:00.5')).toBe(86_400 + 7_200);
  });
});
