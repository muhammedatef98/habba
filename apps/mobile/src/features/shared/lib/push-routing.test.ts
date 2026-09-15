/**
 * Where a tapped notification lands.
 *
 * This runs on a cold start, before any screen has rendered, against a payload
 * that arrives from the operating system. Both facts are why it is a pure
 * function with its own tests: a throw here is a crash on launch, and a wrong
 * route sends a technician who tapped a job offer to their own car's logbook at
 * the one moment they have 45 seconds to answer.
 */

import { describe, expect, test } from 'vitest';
import { destinationFor } from './push-routing.js';

describe('destinationFor', () => {
  test('a job offer opens the job, in provider mode', () => {
    // `requiresMode` is not cosmetic: `(provider)/_layout.tsx` redirects out of
    // the group in customer mode, so without it the tap appears to do nothing.
    expect(destinationFor({ kind: 'job_offer', orderId: 'ord-1' })).toEqual({
      pathname: '/job',
      params: { id: 'ord-1' },
      requiresMode: 'provider',
    });
  });

  test('an order update opens tracking, in customer mode', () => {
    expect(destinationFor({ kind: 'order', orderId: 'ord-2' })).toEqual({
      pathname: '/tracking',
      params: { id: 'ord-2' },
      requiresMode: 'customer',
    });
  });

  test('an unknown kind routes nowhere', () => {
    // A newer server talking to an older app. Guessing a route would open an
    // arbitrary screen with an id that means something else entirely.
    expect(destinationFor({ kind: 'payout_settled', orderId: 'ord-3' })).toBeNull();
  });

  test('a payload without a usable order id routes nowhere', () => {
    expect(destinationFor({ kind: 'job_offer' })).toBeNull();
    expect(destinationFor({ kind: 'job_offer', orderId: '' })).toBeNull();
    expect(destinationFor({ kind: 'job_offer', orderId: 42 })).toBeNull();
  });

  test('a malformed payload returns null rather than throwing', () => {
    // The OS hands this over on launch. A throw is a crash before the first
    // frame, on a device we cannot reproduce.
    expect(destinationFor(null)).toBeNull();
    expect(destinationFor(undefined)).toBeNull();
    expect(destinationFor('job_offer')).toBeNull();
    expect(destinationFor([])).toBeNull();
  });
});
