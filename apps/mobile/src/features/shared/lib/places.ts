/**
 * Places a customer comes back to: home, work, and the last few spots they
 * sent a technician to.
 *
 * Kept on the phone (preferences.ts), never on the server: where someone lives
 * is theirs, and the only use of this list is to save them dragging the map
 * across the city a second time. The operators can hide the feature (0093),
 * which hides the list; it does not read it.
 *
 * Pure, so the rules — what counts as the same place, how many are kept, what
 * an address line looks like — are tested without a phone.
 */

import type { DeviceLocation } from './location-provider.js';

export type PlaceKind = 'home' | 'work' | 'recent';

export interface SavedPlace {
  readonly kind: PlaceKind;
  readonly lat: number;
  readonly lon: number;
  /** A short address line, possibly empty when the phone could not name it. */
  readonly label: string;
}

/** How many recent places are kept. More than this and the row is a list. */
export const MAX_RECENT = 5;

/** Two spots closer than this are the same place for the customer's purposes. */
export const SAME_PLACE_METRES = 80;

/** Keychain values are small; an address line has no business being long. */
const MAX_LABEL = 120;

const EARTH_RADIUS_M = 6_371_000;

export function distanceMetres(a: DeviceLocation, b: DeviceLocation): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function place(kind: PlaceKind, at: DeviceLocation, label: string): SavedPlace {
  return { kind, lat: at.lat, lon: at.lon, label: label.trim().slice(0, MAX_LABEL) };
}

/**
 * The list after sending a technician to `at`: it becomes the newest recent
 * place, any older recent entry for the same spot goes, and the oldest falls
 * off past MAX_RECENT. Home and work are untouched — and a spot that already
 * is home or work is not repeated as a recent one.
 */
export function rememberRecent(
  places: readonly SavedPlace[],
  at: DeviceLocation,
  label: string,
): readonly SavedPlace[] {
  const labelled = places.filter((entry) => entry.kind !== 'recent');
  if (labelled.some((entry) => distanceMetres(entry, at) < SAME_PLACE_METRES)) return places;

  const recent = places.filter(
    (entry) => entry.kind === 'recent' && distanceMetres(entry, at) >= SAME_PLACE_METRES,
  );
  return [...labelled, place('recent', at, label), ...recent.slice(0, MAX_RECENT - 1)];
}

/** Sets home or work to `at`, replacing the old one, and drops a recent duplicate. */
export function setLabelledPlace(
  places: readonly SavedPlace[],
  kind: 'home' | 'work',
  at: DeviceLocation,
  label: string,
): readonly SavedPlace[] {
  const others = places.filter(
    (entry) =>
      entry.kind !== kind &&
      !(entry.kind === 'recent' && distanceMetres(entry, at) < SAME_PLACE_METRES),
  );
  return [place(kind, at, label), ...others];
}

/** Home first, then work, then recent places newest first. */
export function orderedPlaces(places: readonly SavedPlace[]): readonly SavedPlace[] {
  const rank: Record<PlaceKind, number> = { home: 0, work: 1, recent: 2 };
  return [...places].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Reads a stored list, dropping anything malformed rather than failing. */
export function parsePlaces(raw: string | null): readonly SavedPlace[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): SavedPlace[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { kind, lat, lon, label } = entry as Record<string, unknown>;
      const validKind = kind === 'home' || kind === 'work' || kind === 'recent';
      const validPoint =
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180;
      if (!validKind || !validPoint) return [];
      return [place(kind, { lat, lon }, typeof label === 'string' ? label : '')];
    });
  } catch {
    return [];
  }
}

/** The pieces a phone's reverse geocoder returns (expo-location's shape). */
export interface AddressParts {
  readonly name?: string | null;
  readonly street?: string | null;
  readonly streetNumber?: string | null;
  readonly district?: string | null;
  readonly subregion?: string | null;
  readonly city?: string | null;
  readonly region?: string | null;
}

/**
 * «حي الملقا، طريق أنس بن مالك، الرياض» — district, street, city, the order a
 * Saudi driver gives directions in. Repeats are dropped (geocoders often
 * return the street as the name too), and so is a bare building number.
 */
export function formatAddress(parts: AddressParts): string {
  const street =
    parts.street ??
    (parts.name !== undefined && parts.name !== null && !/^\d+$/.test(parts.name)
      ? parts.name
      : null);
  const city = parts.city ?? parts.subregion ?? parts.region ?? null;
  const seen = new Set<string>();
  return [parts.district, street, city]
    .map((part) => (part ?? '').trim())
    .filter((part) => {
      if (part.length === 0 || seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join('، ');
}

/**
 * What the address field should hold once the spot under the pin has a name.
 *
 * `autoFilled` is the last line the app itself wrote there. While the field
 * is empty or still holds it, the customer has not written their own, so the
 * new name replaces it — or clears it when the phone could not name the new
 * spot, rather than leaving the old place's name on a request sent from
 * somewhere else. Anything the customer typed is theirs and stays.
 */
export function addressAfterPinMove(
  current: string,
  autoFilled: string | null,
  named: string | null,
): { readonly address: string; readonly autoFilled: string | null } | null {
  const typed = current.trim();
  if (typed.length > 0 && typed !== autoFilled) return null;
  return { address: named ?? '', autoFilled: named };
}
