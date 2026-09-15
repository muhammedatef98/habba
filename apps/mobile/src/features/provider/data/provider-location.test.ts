/**
 * The technician's position actually leaves the phone.
 *
 * `SupabaseProviderRepository.currentPosition()` threw unconditionally for the
 * whole life of the provider feature, behind a comment claiming the native
 * build supplied it. Nothing did. Every broadcast tick raised,
 * `update_provider_location` was never called, and `match_providers` — which
 * only considers a fix newer than `location_freshness_limit()` — could not see
 * the technician. They went online and received no work, indistinguishable from
 * a quiet night.
 *
 * These tests exist so that cannot come back silently. They inject a
 * `LocationProvider` rather than reaching for the real one: the point is the
 * wiring between the two, not expo-location's behaviour.
 */

import { describe, expect, test } from 'vitest';
import type { LocationProvider, LocationResult } from '@/features/shared/lib/location-provider';
import { normaliseHeading } from '@/features/shared/lib/location-provider';
import { SupabaseProviderRepository } from './provider-repository.js';

/** The client is never touched on this path, so there is nothing to fake. */
const NO_CLIENT = null as never;

function providerReturning(result: LocationResult): LocationProvider {
  return { getCurrentLocation: async () => result };
}

function repositoryWith(result: LocationResult): SupabaseProviderRepository {
  return new SupabaseProviderRepository(NO_CLIENT, providerReturning(result));
}

describe('currentPosition', () => {
  test('returns the fix rather than throwing', async () => {
    const repository = repositoryWith({
      ok: true,
      location: { lon: 50.1033, lat: 26.4207 },
    });

    const result = await repository.currentPosition();

    expect(result).toEqual({
      ok: true,
      position: { lon: 50.1033, lat: 26.4207, heading: undefined },
    });
  });

  test('carries the heading through when the device reported one', async () => {
    const repository = repositoryWith({
      ok: true,
      location: { lon: 50.1033, lat: 26.4207, heading: 87 },
    });

    const result = await repository.currentPosition();

    expect(result.ok && result.position.heading).toBe(87);
  });

  // The reason has to survive the trip: the screen says completely different
  // things about a denial and a basement, and only one of them is a fix.
  test.each(['permission_denied', 'unavailable'] as const)(
    'reports %s as a reason',
    async (reason) => {
      const repository = repositoryWith({ ok: false, reason });

      await expect(repository.currentPosition()).resolves.toEqual({ ok: false, reason });
    },
  );
});

describe('normaliseHeading', () => {
  test('keeps a real bearing', () => {
    expect(normaliseHeading(0)).toBe(0);
    expect(normaliseHeading(359.9)).toBe(359.9);
  });

  // expo-location's "unknown". Passed through raw it would be stored as a
  // bearing and the customer's tracking arrow would point somewhere the
  // technician provably is not facing.
  test('drops the -1 the platform uses for unknown', () => {
    expect(normaliseHeading(-1)).toBeNull();
  });

  test('drops absent, non-finite and out-of-range values', () => {
    expect(normaliseHeading(null)).toBeNull();
    expect(normaliseHeading(undefined)).toBeNull();
    expect(normaliseHeading(Number.NaN)).toBeNull();
    expect(normaliseHeading(400)).toBeNull();
  });
});
