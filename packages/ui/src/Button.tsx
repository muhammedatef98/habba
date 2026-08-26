/**
 * Button primitive.
 *
 * Build prompt §8: minimum 48dp touch target, because this is used one-handed,
 * stressed, at the roadside, sometimes at night. `emergency` exists as its own
 * variant so semantic red stays reserved for genuine emergencies and cannot
 * drift into marketing use.
 */

import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { useTheme } from './theme.js';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'emergency';
export type ButtonSize = 'medium' | 'large';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled = false,
  loading = false,
  fullWidth = true,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const surfaces: Record<ButtonVariant, { background: string; border: string; text: string }> = {
    primary: {
      background: theme.colors.primary,
      border: theme.colors.primary,
      text: theme.colors.primaryText,
    },
    accent: {
      background: theme.colors.accent,
      border: theme.colors.accent,
      text: theme.colors.accentText,
    },
    secondary: {
      background: 'transparent',
      border: theme.colors.borderStrong,
      text: theme.colors.text,
    },
    ghost: { background: 'transparent', border: 'transparent', text: theme.colors.primary },
    emergency: {
      background: theme.colors.emergency,
      border: theme.colors.emergency,
      text: theme.colors.emergencyText,
    },
  };

  const surface = surfaces[variant];
  const height = size === 'large' ? 56 : theme.minTouchTarget;

  const base: ViewStyle = {
    minHeight: height,
    borderRadius: theme.radius.lg,
    borderWidth: variant === 'secondary' ? 1.5 : 0,
    borderColor: surface.border,
    alignItems: 'center',
    justifyContent: 'center',
    // Logical padding — never paddingLeft/Right (§8).
    paddingHorizontal: theme.spacing.lg,
    alignSelf: fullWidth ? 'stretch' : 'flex-start',
  };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      // Guarantees the 48dp target even when the visual box is smaller.
      hitSlop={Math.max(0, (theme.minTouchTarget - height) / 2)}
      style={({ pressed }) => [
        base,
        { backgroundColor: surface.background },
        // Feedback is opacity + scale, both compositor-friendly.
        pressed && !isDisabled ? { opacity: 0.88, transform: [{ scale: 0.985 }] } : null,
        isDisabled ? { opacity: 0.45 } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={surface.text} />
      ) : (
        <View>
          <Text variant="bodyStrong" align="center" style={{ color: surface.text }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
