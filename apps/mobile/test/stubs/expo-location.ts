/**
 * Test stub for `expo-location`.
 *
 * Same reason as the other two stubs in this folder: the real module reaches
 * React Native, whose Flow-typed source Vitest cannot parse. It became
 * load-bearing when `provider/data/provider-repository.ts` started resolving
 * the technician's position through `shared/lib/location.ts` instead of
 * throwing — without this, every suite that touches the provider data layer
 * fails to load.
 *
 * It denies permission, which is the safe default for a test that did not ask:
 * a suite that wants a fix injects its own `LocationProvider` rather than
 * relying on what a stub happens to return. Nothing here should ever look like
 * a real coordinate.
 */

export const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
} as const;

export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
} as const;

export async function requestForegroundPermissionsAsync(): Promise<{ status: string }> {
  return { status: PermissionStatus.DENIED };
}

export async function getCurrentPositionAsync(): Promise<never> {
  throw new Error('expo-location is stubbed in Vitest; inject a LocationProvider instead');
}
