/**
 * The platform half of `@habba/ui`'s haptics.
 *
 * The design system names signals by meaning and knows nothing about waveforms
 * (`packages/ui/src/haptics.ts`); this maps those names onto the taptic engine,
 * and it is the only file in the repo that imports `expo-haptics`.
 *
 * The same abstraction the repo already uses for OTP delivery and for location
 * — and for the same reason. It keeps the design system importable outside a
 * native runtime, and it means the mapping below is one file to revisit when a
 * signal turns out to be too strong, rather than a search across every screen.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import type { HapticDriver, HapticSignal } from '@habba/ui';

/**
 * Meaning → waveform.
 *
 * `selection` is its own API rather than a light impact: on iOS the selection
 * feedback generator is a distinctly crisper tick, and it is the one the OS
 * uses for pickers and segmented controls — so a tab change here feels like a
 * tab change everywhere else on the phone, which is the whole point of using
 * the platform's vocabulary instead of inventing one.
 */
function play(signal: HapticSignal): void {
  switch (signal) {
    case 'selection':
      void Haptics.selectionAsync();
      return;
    case 'light':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case 'medium':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case 'heavy':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    case 'success':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case 'warning':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    case 'error':
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
  }
}

/**
 * The driver, or `null` where there is nothing to drive.
 *
 * Web has no haptics API worth the name, and `expo-haptics` is a no-op there
 * anyway — returning `null` keeps the indirection honest rather than installing
 * a driver that does nothing. Android and iOS both get the real thing; on an
 * Android device without a vibrator the calls resolve harmlessly, and anything
 * that does throw is swallowed by `haptic()` itself.
 */
export function createHapticDriver(): HapticDriver | null {
  if (Platform.OS === 'web') return null;
  return { play };
}
