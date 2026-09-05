/**
 * Bottom sheet.
 *
 * Built on React Native's `Modal` rather than a gesture library: the sheets
 * this app needs (pick a service, confirm a location, choose a year) are
 * selection surfaces, not draggable panels, and a dependency that exists to
 * animate a drag handle is not worth carrying — §3 says build the design
 * system in-house.
 *
 * Motion follows §8: eased and directional, "suggesting wind", never bouncy.
 * The sheet rises; it does not spring.
 *
 * Reachability matters more than aesthetics here. The action sits at the
 * bottom, within thumb reach of someone holding a phone one-handed at the
 * roadside, and the backdrop is dismissible because a sheet that traps you is
 * the worst thing to meet when your car has just broken down.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './Text.js';
import { useTheme } from './theme.js';

export interface BottomSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title?: string | undefined;
  readonly children: ReactNode;
  /** Label for the backdrop, read as "close" by assistive tech. */
  readonly closeLabel: string;
  readonly testID?: string;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  closeLabel,
  testID,
}: BottomSheetProps) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const translate = useRef(new Animated.Value(height)).current;

  useEffect(() => {
    Animated.timing(translate, {
      toValue: visible ? 0 : height,
      duration: visible ? theme.duration.normal : theme.duration.fast,
      // Decelerating, not overshooting. A bouncing sheet reads as playful,
      // which is the wrong register for an emergency app.
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, height, translate, theme.duration.normal, theme.duration.fast]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          testID={testID === undefined ? undefined : `${testID}-backdrop`}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={{ ...StyleSheetAbsoluteFill, backgroundColor: theme.colors.overlay }}
        />

        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          style={{
            transform: [{ translateY: translate }],
            backgroundColor: theme.colors.surface,
            borderTopStartRadius: theme.radius.xl,
            borderTopEndRadius: theme.radius.xl,
            paddingHorizontal: theme.spacing.base,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.xl,
            gap: theme.spacing.md,
            maxHeight: height * 0.85,
          }}
        >
          {/* Grabber: a visual affordance only, so it is hidden from readers. */}
          <View
            accessible={false}
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.colors.border,
            }}
          />

          {title !== undefined ? <Text variant="heading">{title}</Text> : null}

          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

// Inlined rather than importing StyleSheet for one constant.
const StyleSheetAbsoluteFill = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  start: 0,
  end: 0,
} as const;
