/**
 * A one-time code, as boxes rather than as a text field.
 *
 * The OTP screen used a plain `Field`, which works and looks like every other
 * input in the app — so nothing about it said "this is four digits from an
 * SMS". Boxes say the length before a single character is typed, show progress
 * as they fill, and give the eye a place to check the code against the message
 * it was copied from. It is the one input in this product people arrive at
 * already stressed and already holding a number in their short-term memory.
 *
 * One real `TextInput`, invisible, stretched over the boxes. Per-box inputs are
 * the obvious implementation and the wrong one: they fight autofill (iOS pastes
 * the whole code into whichever field is focused), they break backspace across
 * boundaries, and they turn one accessible field into N unlabelled ones.
 */

import { useRef, useState } from 'react';
import { Pressable, TextInput, View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { useTheme } from './theme.js';
import { lineHeightFor } from './tokens.js';

export interface CodeInputProps {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly length: number;
  readonly label: string;
  readonly error?: string | undefined;
  readonly autoFocus?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function CodeInput({
  value,
  onChangeText,
  length,
  label,
  error,
  autoFocus = true,
  style,
  testID,
}: CodeInputProps) {
  const theme = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const hasError = error !== undefined && error.length > 0;
  const digits = [...value].slice(0, length);
  const activeIndex = Math.min(digits.length, length - 1);

  const boxSize = 60;

  return (
    <View style={[{ gap: theme.spacing.sm }, style]}>
      <Text variant="label" tone="muted">
        {label}
      </Text>

      <Pressable
        onPress={() => input.current?.focus()}
        accessible={false}
        // Physical `row-reverse` under RTL would put the first digit on the
        // right; a code is read left-to-right in every locale, the same reason
        // `forceLtrInput` exists on Field.
        // Centred. The boxes must run left-to-right — a code is read that way
        // in every locale — but a left-aligned group on an otherwise
        // right-aligned screen reads as a layout mistake, and right-aligning
        // the group would put box one under the last digit of the heading.
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: theme.spacing.sm,
          direction: 'ltr',
        }}
      >
        {Array.from({ length }, (_, index) => {
          const digit = digits[index] ?? '';
          const isActive = focused && index === activeIndex;

          return (
            <View
              key={index}
              style={{
                width: boxSize,
                height: boxSize,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radius.md,
                borderWidth: isActive ? 2 : 1.5,
                borderColor: hasError
                  ? theme.colors.emergency
                  : isActive
                    ? theme.colors.focusRing
                    : digit.length > 0
                      ? theme.colors.borderStrong
                      : theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text
                variant="heading"
                numeric
                style={{
                  fontSize: theme.fontSize.xl,
                  lineHeight: lineHeightFor(theme.fontSize.xl, 'latin'),
                }}
              >
                {digit}
              </Text>
            </View>
          );
        })}
      </Pressable>

      <TextInput
        ref={input}
        testID={testID}
        value={value}
        onChangeText={(next) => onChangeText(next.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        accessibilityLabel={label}
        {...(hasError ? { accessibilityHint: error } : {})}
        // Invisible but present: `opacity: 0` rather than `display: none`, so
        // it can still hold focus, still receives the autofilled code, and is
        // still the single element a screen reader announces.
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: boxSize + theme.spacing.lg,
          opacity: 0,
        }}
      />

      {hasError ? (
        <Text variant="caption" tone="emergency">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
