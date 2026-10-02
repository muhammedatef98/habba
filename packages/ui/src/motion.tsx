/**
 * Motion — three movements, used everywhere, and switched off on request.
 *
 * 1. `usePressScale`: a press springs down and back. The old feedback was a
 *    style swap on `pressed`, which is instant — it registered, but it did
 *    not feel like anything had been touched.
 * 2. `FadeIn`: content arrives with a short rise and fade instead of
 *    appearing between one frame and the next. `delay` staggers a list.
 * 3. `Pop`: a success mark springs in from slightly small — the one moment
 *    that is allowed to announce itself.
 *
 * All three use React Native's own Animated with the native driver (opacity
 * and transform only), so they run off the JS thread and need nothing that
 * Expo Go does not already ship.
 *
 * Reduce Motion (iOS) / Remove animations (Android) turns every one of them
 * into its end state. Motion here is decoration; for someone for whom it is
 * nausea, the screen must be the same screen without it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export const motion = {
  /** Content arriving. Short: this is a phone, not a presentation. */
  enterMs: 260,
  /** How far content rises as it arrives, in dp. */
  enterRise: 8,
  /** Stagger between list items, capped so a long list does not crawl in. */
  staggerMs: 45,
  staggerCap: 8,
  /** Pressed scale. Just enough to see under a thumb. */
  pressScale: 0.97,
} as const;

/** Whether the person has asked the system for less motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/** The delay for the nth item of a list, capped. */
export function staggerDelay(index: number): number {
  return Math.min(index, motion.staggerCap) * motion.staggerMs;
}

/**
 * Spring-on-press for a Pressable made animated with `AnimatedPressable`:
 * spread `handlers` onto it and put `style` last in its style array.
 */
export function usePressScale(disabled = false): {
  readonly style: { opacity: Animated.Value; transform: { scale: Animated.Value }[] };
  readonly handlers: { onPressIn: () => void; onPressOut: () => void };
} {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();

  const to = (pressed: boolean) => {
    if (disabled) return;
    // Reduced motion keeps the dimming — it says "touched" without moving.
    Animated.timing(opacity, {
      toValue: pressed ? 0.88 : 1,
      duration: pressed ? 60 : 140,
      useNativeDriver: true,
    }).start();
    if (reduced) return;
    Animated.spring(scale, {
      toValue: pressed ? motion.pressScale : 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: pressed ? 0 : 6,
    }).start();
  };

  return {
    style: { opacity, transform: [{ scale }] },
    handlers: { onPressIn: () => to(true), onPressOut: () => to(false) },
  };
}

/** A Pressable whose style can carry Animated values. */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface FadeInProps {
  readonly children: ReactNode;
  readonly delay?: number | undefined;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string | undefined;
}

/** Rises and fades in once, on mount. Remount it (a `key`) to play it again. */
export function FadeIn({ children, delay = 0, style, testID }: FadeInProps) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.enterMs,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced]);

  return (
    <Animated.View
      testID={testID}
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [motion.enterRise, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Springs in from slightly small. For the moment something succeeded. */
export function Pop({ children, style, testID }: Omit<FadeInProps, 'delay'>) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [opacity, reduced, scale]);

  return (
    <Animated.View testID={testID} style={[style, { opacity, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}
