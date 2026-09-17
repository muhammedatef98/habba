/**
 * Touch feedback.
 *
 * The one sense this app could use and did not. §8's premise is that people
 * reach for it one-handed, stressed, at the roadside, often at night and often
 * in a car that is making a noise — the three channels a phone has for saying
 * "yes, that registered" are sight, sound and touch, and the first is
 * unreliable in sunlight while the second is unreliable next to a running
 * engine. Touch is the one that survives both. Until now every press in the app
 * was silent to the hand.
 *
 * The signals are named for what happened, never for a waveform. A caller asks
 * for `success`, not `notificationAsync(Success)`: the mapping from meaning to
 * waveform belongs here, in one place, so it can be tuned once rather than
 * argued about at 40 call sites.
 *
 * ---
 *
 * WHY A DRIVER RATHER THAN AN IMPORT
 *
 * `@habba/ui` has no Expo dependency and this does not add one. The package is
 * consumed by the mobile app today and by whatever renders the public
 * تقرير هبّة tomorrow; an `expo-haptics` import at the bottom of the design
 * system would make the design system un-importable anywhere a taptic engine
 * does not exist.
 *
 * So it follows the shape CLAUDE.md §3 already uses for Nafath, and the repo
 * already uses for `otp-provider` and `location-provider`: an interface here,
 * the real implementation injected by the app at boot. It also means the
 * default is silence — a host that never installs a driver gets no haptics and
 * no crash, which is exactly what a test renderer and a web build want.
 */

/**
 * What happened, in the hand.
 *
 * Deliberately short. Every additional signal is a decision someone has to make
 * at a call site, and a vocabulary of twelve vibrations is one nobody learns —
 * so this is the smallest set that still distinguishes the things that must not
 * feel alike.
 */
export type HapticSignal =
  /** A choice landed: a tab, a chip, a row, a segment. The lightest tick. */
  | 'selection'
  /** A button was pressed. Weight follows consequence, not size. */
  | 'light'
  | 'medium'
  | 'heavy'
  /** It worked. Reserved for a committed change, never for a screen opening. */
  | 'success'
  /** It went through, but read this. */
  | 'warning'
  /** It did not work. */
  | 'error';

export interface HapticDriver {
  /**
   * Play a signal. Must not throw and must not block — every implementation is
   * fire-and-forget, because nothing in the UI may wait on a vibration.
   */
  readonly play: (signal: HapticSignal) => void;
}

let driver: HapticDriver | null = null;

/**
 * Install the platform's haptics, or pass `null` to remove them.
 *
 * Called once from the app's root layout. Exported rather than hidden so a
 * test can install a spy and assert that the emergency button feels different
 * from the cancel button — which is the sort of thing that silently regresses
 * the first time someone refactors a Pressable.
 */
export function setHapticDriver(next: HapticDriver | null): void {
  driver = next;
}

/**
 * Fire a signal, if a driver is installed.
 *
 * Swallows everything the driver throws. A haptics API failing is a reason for
 * the phone to stay still, never a reason for the button that was pressed to
 * stop working — and on Android the vibration permission can be revoked out
 * from under a running app, so this is a real path rather than a defensive
 * flourish.
 */
export function haptic(signal: HapticSignal): void {
  if (driver === null) return;

  try {
    driver.play(signal);
  } catch {
    // Intentionally silent: see above. There is no user-facing consequence to
    // report and nothing for the caller to do about it.
  }
}
