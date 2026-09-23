import { describe, expect, test } from 'vitest';
import { changedFields } from './ops-repository';

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
