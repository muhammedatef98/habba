/**
 * Device location, behind an interface.
 *
 * Two implementations: real GPS via expo-location, and a fixed-coordinate stub
 * for the dev build and tests. The interface is the point — the emergency flow
 * was built and tested against the stub long before GPS existed, and swapping
 * them is a line in `location.ts`, not a screen change.
 */

import * as Location from 'expo-location';

export interface DeviceLocation {
  readonly lon: number;
  readonly lat: number;
  /**
   * Degrees clockwise from true north, when the device can say — used to point
   * the technician's arrow on the customer's tracking map.
   *
   * Optional because most callers have no use for it, and null far more often
   * than you would expect: a stationary phone has no bearing to report, and
   * neither does a simulator. See `normaliseHeading` for why it is never passed
   * through raw.
   */
  readonly heading?: number | null;
}

/**
 * Turns whatever the platform reports into a bearing or nothing.
 *
 * expo-location reports `-1` for "unknown", which is not a compass bearing and
 * would be stored as one: `update_provider_location` takes the number it is
 * given. A customer watching the tracking map would see the arrow snap to a
 * direction the technician is provably not facing, which is worse than an arrow
 * that does not rotate at all.
 *
 * Out-of-range values are dropped for the same reason rather than wrapped —
 * a device reporting 400° is a device whose compass should not be trusted to
 * have meant 40°.
 */
export function normaliseHeading(heading: number | null | undefined): number | null {
  if (heading === null || heading === undefined) return null;
  if (!Number.isFinite(heading)) return null;
  if (heading < 0 || heading > 360) return null;
  return heading;
}

export type LocationResult =
  | { readonly ok: true; readonly location: DeviceLocation }
  | { readonly ok: false; readonly reason: 'permission_denied' | 'unavailable' };

export interface LocationProvider {
  getCurrentLocation(): Promise<LocationResult>;
}

/** Dammam city centre. */
const DEV_FIXED_LOCATION: DeviceLocation = { lon: 50.1033, lat: 26.4207 };

/**
 * Fixed Eastern Province coordinate (CLAUDE.md §0: launch markets are Eastern
 * Province + Riyadh), so `assert_plausible_coordinate` on the server always
 * accepts it.
 */
export class DevLocationProvider implements LocationProvider {
  async getCurrentLocation(): Promise<LocationResult> {
    return { ok: true, location: DEV_FIXED_LOCATION };
  }
}

/**
 * Real GPS.
 *
 * `Balanced` accuracy, not `Highest`. The difference is a few metres and
 * several seconds of extra fix time, and this runs on the screen where someone
 * is waiting to summon help — the free-text landmark beside the map closes any
 * gap far better than a slower, more precise fix would. `Highest` also drives
 * the GPS chip hard on a phone whose battery may be the reason they are
 * stranded.
 *
 * ⚠️ Permission is requested, never assumed. A denial is a normal outcome
 * here — the flow has an address field precisely so it can continue without
 * coordinates — so this returns a reason rather than throwing.
 */
export class ExpoLocationProvider implements LocationProvider {
  async getCurrentLocation(): Promise<LocationResult> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.GRANTED) {
        return { ok: false, reason: 'permission_denied' };
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        ok: true,
        location: {
          lon: position.coords.longitude,
          lat: position.coords.latitude,
          heading: normaliseHeading(position.coords.heading),
        },
      };
    } catch {
      // Indoors, airplane mode, a simulator with no location set — all of
      // which the caller handles identically by falling back to the address.
      return { ok: false, reason: 'unavailable' };
    }
  }
}
