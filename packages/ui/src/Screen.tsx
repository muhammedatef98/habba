/**
 * Screen container: safe areas, background, keyboard avoidance, scroll.
 *
 * Centralised so every screen gets correct insets and dark-mode background
 * without repeating it — and so the keyboard behaviour difference between iOS
 * and Android is decided once.
 */

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewStyle } from 'react-native';
import { useTheme } from './theme.js';

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

  const content: ViewStyle = {
    flex: scrollable ? 0 : 1,
    padding: padded ? theme.spacing.base : 0,
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
