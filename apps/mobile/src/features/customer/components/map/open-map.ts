/**
 * The Android map: MapLibre drawing OpenStreetMap through OpenFreeMap.
 *
 * Android does not use Google Maps (owner's decision, 2026-10-09): no Google
 * key, no Google Cloud billing account. OpenFreeMap serves a ready MapLibre
 * style with no key and no account; the attribution it needs (OpenFreeMap,
 * OpenMapTiles, OpenStreetMap) is drawn by the map's own attribution button,
 * which therefore stays on. iOS keeps Apple Maps through react-native-maps and
 * never loads any of this — the `.android.tsx` files are the only importers,
 * and `react-native.config.js` keeps each native library on its own platform.
 */

/** Liberty: the OpenFreeMap style that is actively maintained. */
export const OPEN_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * The zoom level that shows about `spanDegrees` of latitude across the map,
 * so the Android map opens as close in as the iOS one (which is set by span).
 */
export function zoomForSpan(spanDegrees: number): number {
  return Math.log2(360 / spanDegrees);
}
