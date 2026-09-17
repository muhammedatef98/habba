/**
 * Button primitive.
 *
 * Build prompt §8: minimum 48dp touch target, because this is used one-handed,
 * stressed, at the roadside, sometimes at night. `emergency` exists as its own
 * variant so semantic red stays reserved for genuine emergencies and cannot
 * drift into marketing use.
 */

import { ActivityIndicator, PixelRatio, Pressable, View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { scaledHeight } from './font-scale.js';
import { haptic, type HapticSignal } from './haptics.js';
import { useTheme } from './theme.js';

export type ButtonVariant =
  'primary' | 'accent' | 'secondary' | 'ghost' | 'emergency' | 'emergencyOutline';
export type ButtonSize = 'medium' | 'large';

/**
 * How hard each variant lands in the hand.
 *
 * Weight follows consequence, not prominence. `emergency` is the only heavy
 * one in the app — it is the press that sends a technician to a roadside, and
 * it should not feel like dismissing a sheet. `ghost` is the lightest because
 * it is nearly always a "not now".
 *
 * Read this table next to the colour table below: the two say the same thing
 * in two senses, which is the point. Someone whose eyes are on the traffic
 * still knows which button they just hit.
 */
const VARIANT_HAPTIC: Readonly<Record<ButtonVariant, HapticSignal>> = {
  emergency: 'heavy',
  emergencyOutline: 'medium',
  primary: 'medium',
  accent: 'medium',
  secondary: 'light',
  ghost: 'selection',
};

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
    // Outlined rather than filled. Cancelling is destructive but routine, and
    // a solid red block reads as an alarm the user has to escape — the design
    // reserves that weight for the active-emergency bar alone.
    emergencyOutline: {
      background: 'transparent',
      border: theme.colors.emergencyFg,
      text: theme.colors.emergencyFg,
    },
  };

  const surface = surfaces[variant];
  // Grown with the device's text setting: a 56dp box cannot hold a label that
  // the OS has scaled to 1.5×, and the clipping that follows is how "honouring
  // the accessibility setting" turns into "unreadable" (font-scale.ts).
  const height = scaledHeight(
    size === 'large' ? 56 : theme.minTouchTarget,
    PixelRatio.getFontScale(),
  );

  const base: ViewStyle = {
    minHeight: height,
    borderRadius: theme.radius.lg,
    borderWidth: variant === 'secondary' || variant === 'emergencyOutline' ? 1.5 : 0,
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
      // Fired here rather than in `onPress` so the tick lands with the finger
      // going down, not with whatever the handler does afterwards. A press that
      // opens a screen would otherwise buzz a frame *after* the screen appears,
      // which reads as a stray vibration rather than as feedback.
      onPressIn={() => haptic(VARIANT_HAPTIC[variant])}
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
