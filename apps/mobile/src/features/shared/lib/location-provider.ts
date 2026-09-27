/**
 * Device location, behind an interface.
 *
 * Two implementations: real GPS via expo-location, and a fixed-coordinate stub
 * for the dev build and tests. The interface is the point — the emergency flow
 * was built and tested against the stub long before GPS existed, and swapping
 * them is a line in `location.ts`, not a screen change.
 */

import * as Location from 'expo-location';
import { formatAddress } from './places.js';

export interface DeviceLocation {
  readonly lon: number;
  readonly lat: number;
}

export type LocationResult =
  | {
      readonly ok: true;
      readonly location: DeviceLocation;
      /** How far off the fix may be, in metres, when the phone says. */
      readonly accuracyMetres?: number | undefined;
    }
  | { readonly ok: false; readonly reason: 'permission_denied' | 'unavailable' };

/** A place an address search found. */
export interface PlaceMatch {
  readonly location: DeviceLocation;
  readonly label: string;
}

export interface LocationProvider {
  getCurrentLocation(): Promise<LocationResult>;
  /**
   * A short address line for a spot («حي الملقا، طريق أنس بن مالك، الرياض»),
   * or null when the phone cannot name it. Never throws.
   */
  describe(location: DeviceLocation): Promise<string | null>;
  /** Places matching a typed address or landmark, best first. Never throws. */
  search(query: string): Promise<readonly PlaceMatch[]>;
}

/** Search results kept: enough to choose from, few enough to read. */
const MAX_MATCHES = 4;

/** Dammam city centre. */
const DEV_FIXED_LOCATION: DeviceLocation = { lon: 50.1033, lat: 26.4207 };

/**
 * Where the map opens when the phone cannot say where it is (Riyadh centre,
 * the larger launch market). Only ever a starting view: the emergency screen
 * will not send an order pinned here until the customer has moved the map,
 * or a technician would drive to the middle of the city.
 */
export const MAP_FALLBACK_LOCATION: DeviceLocation = { lon: 46.6753, lat: 24.7136 };

/** True once a settled map position is meaningfully away from the fallback. */
export function movedFromFallback(location: DeviceLocation): boolean {
  return (
    Math.abs(location.lon - MAP_FALLBACK_LOCATION.lon) > 0.0005 ||
    Math.abs(location.lat - MAP_FALLBACK_LOCATION.lat) > 0.0005
  );
}

/**
 * Fixed Eastern Province coordinate (CLAUDE.md §0: launch markets are Eastern
 * Province + Riyadh), so `assert_plausible_coordinate` on the server always
 * accepts it.
 */
export class DevLocationProvider implements LocationProvider {
  async getCurrentLocation(): Promise<LocationResult> {
    return { ok: true, location: DEV_FIXED_LOCATION, accuracyMetres: 12 };
  }

  async describe(location: DeviceLocation): Promise<string | null> {
    const nearest = DEV_PLACES.reduce((best, place) =>
      Math.abs(place.location.lat - location.lat) + Math.abs(place.location.lon - location.lon) <
      Math.abs(best.location.lat - location.lat) + Math.abs(best.location.lon - location.lon)
        ? place
        : best,
    );
    return nearest.label;
  }

  async search(query: string): Promise<readonly PlaceMatch[]> {
    const needle = query.trim();
    if (needle.length === 0) return [];
    return DEV_PLACES.filter((place) => place.label.includes(needle)).slice(0, MAX_MATCHES);
  }
}

/** A handful of real places, so search and naming work in the dev build too. */
const DEV_PLACES: readonly PlaceMatch[] = [
  { location: DEV_FIXED_LOCATION, label: 'حي الشاطئ، طريق الخليج، الدمام' },
  { location: { lon: 50.2083, lat: 26.2794 }, label: 'حي العليا، طريق الملك فهد، الخبر' },
  { location: { lon: 50.1119, lat: 26.2886 }, label: 'حي الدوحة الجنوبية، الظهران' },
  { location: { lon: 46.6753, lat: 24.7136 }, label: 'حي المربع، طريق الملك فهد، الرياض' },
  { location: { lon: 46.6389, lat: 24.8126 }, label: 'حي الملقا، طريق أنس بن مالك، الرياض' },
  { location: { lon: 49.6583, lat: 27.0046 }, label: 'حي الفناتير، الجبيل' },
];

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
        accuracyMetres: position.coords.accuracy ?? undefined,
      };
    } catch {
      // Indoors, airplane mode, a simulator with no location set — all of
      // which the caller handles identically by falling back to the address.
      return { ok: false, reason: 'unavailable' };
    }
  }

  /**
   * The phone's own geocoder: Apple's on iOS, Google Play services' on
   * Android. No API key, no cost, and no address leaves for a third party
   * the phone does not already talk to.
   */
  async describe(location: DeviceLocation): Promise<string | null> {
    try {
      const [first] = await Location.reverseGeocodeAsync({
        latitude: location.lat,
        longitude: location.lon,
      });
      if (first === undefined) return null;
      const line = formatAddress(first);
      return line.length > 0 ? line : null;
    } catch {
      return null;
    }
  }

  async search(query: string): Promise<readonly PlaceMatch[]> {
    const needle = query.trim();
    if (needle.length < 2) return [];
    try {
      // Saudi Arabia is where Habba works; saying so turns «العليا» into the
      // district in Riyadh or Khobar rather than a street somewhere else.
      const hits = await Location.geocodeAsync(`${needle}، السعودية`);
      const matches = await Promise.all(
        hits.slice(0, MAX_MATCHES).map(async (hit) => {
          const location = { lat: hit.latitude, lon: hit.longitude };
          return { location, label: (await this.describe(location)) ?? needle };
        }),
      );
      return matches;
    } catch {
      return [];
    }
  }
}
