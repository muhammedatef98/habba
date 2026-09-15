import { describe, expect, test } from 'vitest';
import {
  isBroadcastBlocked,
  isBroadcastStale,
  LOCATION_INTERVAL_MS,
  LOCATION_STALE_AFTER_MS,
} from './shift.js';

describe('broadcast staleness', () => {
  test('never having broadcast counts as stale', () => {
    // Toggling online is not the same as being visible to dispatch. Until a
    // position lands, the provider is not matchable.
    expect(isBroadcastStale(null)).toBe(true);
  });

  test('a recent fix is not stale', () => {
    const now = Date.now();
    expect(isBroadcastStale(now - 30_000, now)).toBe(false);
  });

  test('a fix older than the matcher tolerates is stale', () => {
    // match_providers ignores positions older than five minutes. Past that,
    // the technician believes they are working while receiving nothing — and
    // silence looks exactly like a quiet night.
    const now = Date.now();
    expect(isBroadcastStale(now - LOCATION_STALE_AFTER_MS - 1_000, now)).toBe(true);
  });

  test('the broadcast interval leaves room for retries before going stale', () => {
    // If the cadence were close to the staleness window, a single failed push
    // would drop the provider out of dispatch.
    expect(LOCATION_INTERVAL_MS * 4).toBeLessThan(LOCATION_STALE_AFTER_MS);
  });
});

describe('which failures are worth retrying', () => {
  test('a denial stops the loop', () => {
    // Nothing on the phone will change the answer, and asking again every
    // twenty seconds wakes the GPS on the battery this person works off.
    expect(isBroadcastBlocked('permission_denied')).toBe(true);
  });

  test('a missing fix and a refused write both keep retrying', () => {
    // A basement ends when they drive out of it; a dropped connection comes
    // back. Giving up on either would strand a technician who is doing nothing
    // wrong.
    expect(isBroadcastBlocked('unavailable')).toBe(false);
    expect(isBroadcastBlocked('rejected')).toBe(false);
  });

  test('no failure is not a blocked failure', () => {
    expect(isBroadcastBlocked(null)).toBe(false);
  });
});
