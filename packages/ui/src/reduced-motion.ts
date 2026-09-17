/**
 * "Reduce Motion", honoured rather than ignored.
 *
 * iOS and Android both let someone say that animation makes them unwell —
 * vestibular disorders, migraine, motion sickness. The setting is not a
 * preference about taste; for the people who turn it on, a sheet that slides
 * and a banner that flies in are symptoms. §8 asks for motion that suggests
 * wind, and this is the rest of that sentence: for anyone who has asked, the
 * wind stops.
 *
 * What it does NOT mean is "remove the feedback". A toast that no longer slides
 * still has to appear, or the accessibility setting has quietly deleted the
 * confirmation that the save worked. Every consumer collapses its animation to
 * an instant state change — same start, same end, no journey.
 *
 * Read live rather than once: the setting can be toggled from Control Centre
 * while the app is foregrounded, and a value captured at mount would be wrong
 * for the rest of the session.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // `isReduceMotionEnabled` rejects rather than resolving false on platforms
    // that do not implement it, so the catch is the web/test path, not an edge
    // case. Defaulting to "animate" is the right side to fail on: an animation
    // nobody asked to stop is a smaller harm than a confirmation that never
    // arrives.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduced(enabled);
      })
      .catch(() => {
        if (!cancelled) setReduced(false);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduced(enabled),
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}
