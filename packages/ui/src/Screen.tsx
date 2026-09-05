/**
 * Screen container: safe areas, background, keyboard avoidance, scroll.
 *
 * Centralised so every screen gets correct insets and dark-mode background
 * without repeating it — and so the keyboard behaviour difference between iOS
 * and Android is decided once.
 *
 * ⚠️ The insets were named in this comment from the start but never actually
 * applied, so every screen title rendered underneath the status bar and the
 * clock. Caught on the simulator, not by a test — nothing here asserts layout.
 * `SafeAreaProvider` has always been mounted in the customer app's root layout;
 * only the consumption was missing.
 */

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme.js';

/**
 * Floor for the bottom inset, in dp.
 *
 * On a device with a home indicator, iOS claims roughly this strip for the
 * system swipe. A control sitting inside it looks tappable and is not — the
 * gesture recogniser wins. Observed on the video-triage screen, where the skip
 * button ended up 18dp from the edge and simply did not respond, which reads
 * as a broken button rather than a layout problem.
 *
 * `max` rather than an addition: where the real inset is already this large or
 * larger it is used unchanged, so this cannot double-pad a notched device.
 */
const HOME_INDICATOR_RESERVE = 34;

export interface ScreenProps {
  readonly children: ReactNode;
  readonly scrollable?: boolean;
  readonly padded?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function Screen({
  children,
  scrollable = false,
  padded = true,
  style,
  testID,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const gutter = padded ? theme.spacing.base : 0;

  const content: ViewStyle = {
    flex: scrollable ? 0 : 1,
    // Inset plus gutter, not max(): on a notched device the status bar should
    // clear the text AND the text should keep its own breathing room, which
    // max() would collapse into one.
    paddingTop: insets.top + gutter,
    paddingBottom: Math.max(insets.bottom, HOME_INDICATOR_RESERVE) + gutter,
    paddingLeft: insets.left + gutter,
    paddingRight: insets.right + gutter,
    gap: theme.spacing.base,
  };

  const body = scrollable ? (
    <ScrollView
      contentContainerStyle={[content, { flexGrow: 1 }, style]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[content, style]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      testID={testID}
      // `padding` is correct on iOS; Android resizes the window itself and
      // double-handling it causes a visible jump.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      {body}
    </KeyboardAvoidingView>
  );
}
