/**
 * Links that open turn-by-turn directions to a job (0099).
 *
 * The phone's own maps app first — Apple Maps on iOS, Google Maps on Android,
 * both installed and signed in already — with Google's universal link as the
 * fallback when a scheme will not open. Waze alongside, because it is what a
 * good share of Saudi drivers navigate with.
 *
 * Coordinates, never the address text: the customer's pin is exact, and an
 * address typed at the roadside («عند البوابة ٣») is not something a maps
 * search can find.
 */

export interface Destination {
  readonly lat: number;
  readonly lon: number;
}

export interface NavigationLinks {
  /** The platform's own maps app. */
  readonly native: string;
  /** Opens in any browser, or Google Maps if installed. */
  readonly web: string;
  readonly waze: string;
}

export function navigationLinks(
  destination: Destination,
  platform: 'ios' | 'android' | string,
): NavigationLinks {
  const point = `${destination.lat.toFixed(6)},${destination.lon.toFixed(6)}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`;
  return {
    native:
      platform === 'ios'
        ? `maps://?daddr=${point}&dirflg=d`
        : platform === 'android'
          ? `google.navigation:q=${point}&mode=d`
          : web,
    web,
    waze: `https://waze.com/ul?ll=${point}&navigate=yes`,
  };
}
