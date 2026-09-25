/**
 * The message from `state/toast`, sliding down from under the status bar.
 *
 * Announced to screen readers as it appears (a live region), stays long
 * enough to read a sentence, and can be dismissed by tapping it. Under
 * Reduce Motion it appears and disappears without travelling.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Row, Text, useReducedMotion, useTheme } from '@habba/ui';
import { useToast } from '@/features/shared/state/toast';

const VISIBLE_MS = 3500;

export function Toast() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { message, tone, serial, hide } = useToast();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message === null) return;
    progress.setValue(reduced ? 1 : 0);
    if (!reduced) {
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        speed: 16,
        bounciness: 4,
      }).start();
    }
    const timer = setTimeout(() => {
      Animated.timing(progress, {
        toValue: 0,
        duration: reduced ? 0 : 180,
        useNativeDriver: true,
      }).start(() => hide());
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [hide, message, progress, reduced, serial]);

  if (message === null) return null;

  const isError = tone === 'error';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + theme.spacing.sm,
        left: theme.spacing.base,
        right: theme.spacing.base,
        zIndex: 1000,
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
        ],
      }}
    >
      <Pressable
        testID="toast"
        onPress={hide}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={{
          backgroundColor: isError ? theme.colors.emergencySubtle : theme.colors.successSubtle,
          borderColor: isError ? theme.colors.emergency : theme.colors.successBorder,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.base,
          shadowColor: '#000',
          ...theme.elevation.md,
        }}
      >
        <Row gap="sm">
          <Icon
            name={isError ? 'alert' : 'check'}
            size={theme.iconSize.sm}
            color={isError ? theme.colors.emergency : theme.colors.successFg}
          />
          <Text variant="bodySmall" tone={isError ? 'emergency' : 'success'} style={{ flex: 1 }}>
            {message}
          </Text>
        </Row>
      </Pressable>
    </Animated.View>
  );
}
