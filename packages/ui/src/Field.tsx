/**
 * Labelled text input with inline error.
 *
 * CLAUDE.md §12: errors are surfaced to the user in Arabic, plainly, with a
 * next action. That is why `error` is a required-to-consider prop and renders
 * inline next to the field rather than as a toast the user can miss.
 */

import { TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';
import { Text } from './Text.js';
import { useTheme } from './theme.js';

export interface FieldProps extends Omit<TextInputProps, 'style' | 'onChangeText'> {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly keyboardType?: KeyboardTypeOptions;
  /**
   * Forces LTR entry inside an RTL layout. Phone numbers, plates and VINs are
   * read left-to-right even in Arabic UI — without this the cursor and digits
   * jump around as the user types, which feels broken.
   */
  readonly forceLtrInput?: boolean;
  readonly testID?: string;
}

export function Field({
  label,
  value,
  onChangeText,
  error,
  hint,
  forceLtrInput = false,
  testID,
  ...rest
}: FieldProps) {
  const theme = useTheme();
  const hasError = error !== undefined && error.length > 0;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>

      <TextInput
        {...rest}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.colors.textSubtle}
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={{
          minHeight: theme.minTouchTarget,
          borderWidth: 1.5,
          borderColor: hasError ? theme.colors.emergency : theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          color: theme.colors.text,
          fontSize: theme.fontSize.base,
          fontFamily: theme.fontFamily.arabic,
          textAlign: forceLtrInput ? 'left' : theme.isRtl ? 'right' : 'left',
          writingDirection: forceLtrInput ? 'ltr' : theme.direction,
        }}
      />

      {hasError ? (
        <Text variant="caption" style={{ color: theme.colors.emergency }}>
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text variant="caption" tone="subtle">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
