/**
 * Device location, behind an interface.
 *
 * ⚠️ OPEN DECISION — real GPS needs `expo-location` and a runtime permission
 * prompt, neither wired up yet. The same shape as `otp-provider.ts`: the whole
 * emergency flow — location confirm, address entry, order creation — can be
 * built and tested against a stub, and swapping in real GPS is one
 * implementation of this interface, not a screen change.
 *
 * The stub returns a fixed Eastern Province coordinate (CLAUDE.md §0: launch
 * markets are Eastern Province + Riyadh) so `assert_plausible_coordinate` on
 * the server always accepts it.
 */

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

export class DevLocationProvider implements LocationProvider {
  async getCurrentLocation(): Promise<LocationResult> {
    return { ok: true, location: DEV_FIXED_LOCATION };
  }
}
