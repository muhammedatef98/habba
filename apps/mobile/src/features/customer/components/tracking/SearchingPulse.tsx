/**
 * Concentric outward pulse for the searching state.
 *
 * §8: motion should suggest wind — eased and directional, never bouncy. A
 * spinner implies indeterminate mechanical work; a slow outward pulse reads as
 * "reaching further out", which is literally what the matcher is doing as it
 * widens the radius.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@habba/ui';

const RING_DELAYS = [0, 600, 1200] as const;
const RING_SIZES = [200, 140, 84] as const;

function Ring({ size, delay }: { readonly size: number; readonly delay: number }) {
  const theme = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.ease) }), -1, false),
    );
  }, [progress, delay]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.4 - progress.value * 0.3,
    transform: [{ scale: 1 + progress.value * 0.6 }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: theme.radius.full,
          borderWidth: 1,
          borderColor: theme.colors.primary,
        },
        style,
      ]}
    />
  );
}

export function SearchingPulse() {
  const theme = useTheme();

  return (
    <View style={{ height: 230, alignItems: 'center', justifyContent: 'center' }}>
      {RING_SIZES.map((size, index) => (
        <Ring key={size} size={size} delay={RING_DELAYS[index] ?? 0} />
      ))}
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.primarySubtle,
          borderWidth: 1,
          borderColor: theme.colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.accent,
          }}
        />
      </View>
    </View>
  );
}
