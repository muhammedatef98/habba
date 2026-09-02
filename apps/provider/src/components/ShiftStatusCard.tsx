/**
 * The online toggle, as a state rather than a button.
 *
 * §9.2 asks for it to be prominent. It was a full-width button whose label
 * changed — which tells a technician what will happen if they press it, and
 * never plainly tells them what is true right now. Standing in a workshop
 * wondering why nothing is coming in, "إيقاف الاستقبال" is a sentence you have
 * to reason backwards from.
 *
 * So: the state is the headline, the action is a button under it, and a
 * breathing dot says the position feed is alive. The dot is not decoration —
 * §9.2's parenthesis, "(battery + privacy)", is the reason position is only
 * broadcast while online, and a technician is entitled to see that it is
 * running while they are, and stopped when they are not.
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
import { useTranslation } from 'react-i18next';
import { Button, Card, Text, useTheme } from '@habba/ui';

export interface ShiftStatusCardProps {
  readonly isOnline: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly testID?: string | undefined;
}

export function ShiftStatusCard({ isOnline, busy, onToggle, testID }: ShiftStatusCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Card
      {...(testID !== undefined ? { testID } : {})}
      elevation="sm"
      style={{
        gap: theme.spacing.base,
        backgroundColor: isOnline ? theme.colors.successSubtle : theme.colors.surface,
        borderColor: isOnline ? theme.colors.successBorder : theme.colors.border,
        borderWidth: 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <BroadcastDot active={isOnline} />

        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" tone={isOnline ? 'success' : 'muted'}>
            {isOnline ? t('provider.statusOnline') : t('provider.statusOffline')}
          </Text>
          <Text variant="caption" tone="muted">
            {isOnline ? t('provider.shiftSubtitleOnline') : t('provider.offlineHint')}
          </Text>
        </View>
      </View>

      <Button
        testID="online-toggle"
        label={isOnline ? t('provider.goOffline') : t('provider.goOnline')}
        variant={isOnline ? 'secondary' : 'primary'}
        onPress={onToggle}
        loading={busy}
      />
    </Card>
  );
}

/**
 * Breathing while online, flat while offline.
 *
 * The animation is driven by the online flag rather than by each successful
 * broadcast: a dot that blinked per push would be a 20-second heartbeat, which
 * reads as a fault rather than as a steady state. Whether the feed has actually
 * gone stale is a different fact and gets its own warning.
 */
function BroadcastDot({ active }: { readonly active: boolean }) {
  const theme = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [active, progress]);

  const halo = useAnimatedStyle(() => ({
    opacity: active ? 0.4 - progress.value * 0.4 : 0,
    transform: [{ scale: 1 + progress.value * 1.8 }],
  }));

  const size = 14;
  const color = active ? theme.colors.success : theme.colors.borderStrong;

  return (
    <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
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
