import { describe, expect, test } from 'vitest';
import {
  canRecordEvidence,
  checkMileage,
  isActiveJob,
  isEvidenceComplete,
  missingEvidence,
  nextJobStep,
  type CompletionMediaItem,
  type FulfilmentMode,
  type OrderStatus,
} from './job-flow.js';

const BEFORE: CompletionMediaItem = { url: 'https://x/b.jpg', kind: 'before' };
const AFTER: CompletionMediaItem = { url: 'https://x/a.jpg', kind: 'after' };

describe('nextJobStep', () => {
  test('a mobile job drives; a workshop job checks the car in', () => {
    // ADR-0006: workshop orders skip en_route/arrived entirely, so the mode
    // has to be part of the decision. Offering "start driving" to a workshop
    // is offering a button the server rejects.
    expect(nextJobStep('accepted', 'mobile_ondemand').action).toBe('start_driving');
    expect(nextJobStep('accepted', 'mobile_scheduled').action).toBe('start_driving');
    expect(nextJobStep('accepted', 'workshop').action).toBe('check_in_vehicle');
  });

  test('both modes converge on starting work', () => {
    expect(nextJobStep('arrived', 'mobile_ondemand').action).toBe('start_work');
    expect(nextJobStep('checked_in', 'workshop').action).toBe('start_work');
  });

  test('the provider never gets a complete button', () => {
    // Only the customer confirms completion (ADR-0006). A "done" button that
    // fails server-side is worse than no button.
    const modes: FulfilmentMode[] = ['mobile_ondemand', 'mobile_scheduled', 'workshop'];
    for (const mode of modes) {
      expect(nextJobStep('awaiting_approval', mode).action).toBe('none');
      expect(nextJobStep('in_progress', mode).action).toBe('submit_for_approval');
    }
  });

  test('a mode/status pair that cannot occur offers nothing', () => {
    // Caught by the parity test against the real transition table: the mirror
    // was handling `arrived` and `checked_in` without checking the mode, and
    // offered `checked_in → in_progress` on a mobile job and
    // `en_route → arrived` on a workshop job. Neither exists server-side.
    expect(nextJobStep('checked_in', 'mobile_ondemand').action).toBe('none');
    expect(nextJobStep('checked_in', 'mobile_scheduled').action).toBe('none');
    expect(nextJobStep('en_route', 'workshop').action).toBe('none');
    expect(nextJobStep('arrived', 'workshop').action).toBe('none');
  });

  test('only on-demand orders search', () => {
    // A scheduled or workshop customer picked their provider, so there is
    // nothing to broadcast for.
    expect(nextJobStep('searching', 'mobile_ondemand').action).toBe('accept');
    expect(nextJobStep('searching', 'mobile_scheduled').action).toBe('none');
    expect(nextJobStep('searching', 'workshop').action).toBe('none');
  });

  test('terminal states offer nothing', () => {
    for (const status of ['completed', 'cancelled', 'disputed'] as OrderStatus[]) {
      expect(nextJobStep(status, 'mobile_ondemand').action).toBe('none');
    }
  });

  test('every step carries an i18n key, never a literal', () => {
    const statuses: OrderStatus[] = [
      'searching',
      'quoted',
      'accepted',
      'en_route',
      'arrived',
      'checked_in',
      'in_progress',
    ];
    for (const status of statuses) {
      const step = nextJobStep(status, 'mobile_ondemand');
      expect(step.labelKey).toMatch(/^job\./);
    }
  });
});

describe('isActiveJob / canRecordEvidence', () => {
  test('a job is active until it settles', () => {
    expect(isActiveJob('en_route')).toBe(true);
    expect(isActiveJob('awaiting_approval')).toBe(true);
    expect(isActiveJob('completed')).toBe(false);
    expect(isActiveJob('cancelled')).toBe(false);
  });

  test('evidence is recorded on site, not before arriving or after handing back', () => {
    expect(canRecordEvidence('en_route')).toBe(false);
    expect(canRecordEvidence('arrived')).toBe(true);
    expect(canRecordEvidence('checked_in')).toBe(true);
    expect(canRecordEvidence('in_progress')).toBe(true);
    expect(canRecordEvidence('awaiting_approval')).toBe(false);
  });
});

describe('missingEvidence', () => {
  const full = { requiresMileage: true, requiresPhotos: true };

  test('names each missing item rather than reporting a bare failure', () => {
    // "Add an after photo" and "something is wrong" are very different
    // instructions to someone crouched beside a car.
    expect(missingEvidence(full, null, [])).toEqual(['mileage', 'before_photo', 'after_photo']);
    expect(missingEvidence(full, 51000, [])).toEqual(['before_photo', 'after_photo']);
    expect(missingEvidence(full, 51000, [BEFORE])).toEqual(['after_photo']);
    expect(missingEvidence(full, 51000, [BEFORE, AFTER])).toEqual([]);
  });

  test('a before photo alone is not before/after', () => {
    expect(isEvidenceComplete(full, 51000, [BEFORE])).toBe(false);
    expect(isEvidenceComplete(full, 51000, [BEFORE, AFTER])).toBe(true);
  });

  test('extra part photos do not substitute for the after photo', () => {
    const part: CompletionMediaItem = { url: 'https://x/p.jpg', kind: 'part' };
    expect(missingEvidence(full, 51000, [BEFORE, part])).toEqual(['after_photo']);
  });

  test('a photo-exempt service still needs the odometer', () => {
    // Fuel delivery has nothing to photograph, but it still tells us where the
    // odometer stood.
    const exempt = { requiresMileage: true, requiresPhotos: false };
    expect(missingEvidence(exempt, null, [])).toEqual(['mileage']);
    expect(missingEvidence(exempt, 51000, [])).toEqual([]);
  });

  test('NaN is treated as missing, not as a reading', () => {
    // An empty numeric field parses to NaN, which would otherwise sail past a
    // null check and reach the server as a bad value.
    expect(missingEvidence(full, Number.NaN, [BEFORE, AFTER])).toEqual(['mileage']);
  });

  test('a fully exempt service needs nothing', () => {
    const none = { requiresMileage: false, requiresPhotos: false };
    expect(missingEvidence(none, null, [])).toEqual([]);
  });
});

describe('checkMileage', () => {
  test('flags a reading below the recorded odometer', () => {
    expect(checkMileage(40000, 51000, 3)).toBe('below_recorded');
  });

  test('flags a typo the server would happily accept', () => {
    // The server only rejects readings that go DOWN. A fat-fingered extra
    // digit goes up, passes every server check, then poisons the maintenance
    // estimate and prints an absurd number on the resale report.
    expect(checkMileage(510000, 51000, 3)).toBe('implausible_jump');
  });

  test('allows a genuinely large but plausible gap', () => {
    // 400 km/day for 30 days is a lot of driving, not a typo.
    expect(checkMileage(51000 + 12000, 51000, 30)).toBeNull();
  });

  test('says nothing when there is no baseline', () => {
    expect(checkMileage(51000, null, 0)).toBeNull();
  });

  test('tolerates a same-day reading', () => {
    // daysSince 0 must not collapse the ceiling to the last reading itself.
    expect(checkMileage(51200, 51000, 0)).toBeNull();
  });
});
