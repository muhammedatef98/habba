/**
 * The app's location provider instance.
 *
 * Swapping the development stub for real `expo-location` GPS (open decision,
 * see location-provider.ts) happens here and nowhere else.
 */

import { DevLocationProvider, type LocationProvider } from './location-provider.js';

export const locationProvider: LocationProvider = new DevLocationProvider();
