/**
 * A dot with a slow halo behind it — "this is live, right now".
 *
 * The same argument as the searching pulse: a spinner says *the app is busy*,
 * which is untrue here, while a breathing halo says *the thing itself is still
 * moving*. Eased and slow (§8: wind, never bounce), so it reads as presence
 * rather than as an alarm the customer has to answer.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@habba/ui';

export interface LivePulseDotProps {
  readonly color: string;
  readonly size?: number;
}

export function LivePulseDot({ color, size = 8 }: LivePulseDotProps) {
  const theme = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [progress]);

  const halo = useAnimatedStyle(() => ({
    opacity: 0.45 - progress.value * 0.45,
    transform: [{ scale: 1 + progress.value * 1.6 }],
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: theme.radius.full,
            backgroundColor: color,
          },
          halo,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: theme.radius.full,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
