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
        location: { lon: position.coords.longitude, lat: position.coords.latitude },
      };
    } catch {
      // Indoors, airplane mode, a simulator with no location set — all of
      // which the caller handles identically by falling back to the address.
      return { ok: false, reason: 'unavailable' };
    }
  }
}
