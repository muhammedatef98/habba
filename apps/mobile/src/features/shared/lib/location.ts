/**
 * The app's location provider instance.
 *
 * Real GPS on a phone; the fixed stub in the web preview. A simulator with no
 * location set gets `unavailable` from the real one, which the emergency
 * screen already handles (the map opens on a fallback the customer moves).
 */

import { Platform } from 'react-native';
import {
  DevLocationProvider,
  ExpoLocationProvider,
  type LocationProvider,
} from './location-provider.js';

/**
 * Real GPS and the phone's own geocoder everywhere a phone runs the app,
 * Expo Go included: expo-location is part of Expo Go and asks for permission
 * there like anywhere else. This used to hand Expo Go the fixed stub, which
 * put every customer in Dammam and named every pin after the nearest of six
 * sample districts — so a pin anywhere near the city read «حي الشاطئ».
 *
 * The stub is kept for the web preview, which has no geocoder to ask.
 */
export const locationProvider: LocationProvider =
  Platform.OS === 'web' ? new DevLocationProvider() : new ExpoLocationProvider();
