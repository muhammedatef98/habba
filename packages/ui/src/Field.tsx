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
  /**
   * A fixed, non-editable affix rendered inside the field, before the caret.
   *
   * For a country dialling code and nothing else. It is not a placeholder —
   * it does not disappear when the field is filled — and it is not part of the
   * value, so the parser still sees exactly what the customer typed.
   */
  readonly prefix?: string | undefined;
  readonly testID?: string;
}

export function Field({
  label,
  value,
  onChangeText,
  error,
  hint,
  forceLtrInput = false,
  prefix,
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

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: theme.minTouchTarget,
          borderWidth: 1.5,
          borderColor: hasError ? theme.colors.emergency : theme.colors.border,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface,
          paddingStart: theme.spacing.md,
          // The affix supplies the end padding on that side when present, so
          // the caret does not start flush against it.
          paddingEnd: prefix === undefined ? theme.spacing.md : 0,
          // A prefixed field is a dialling code plus digits — left-to-right in
          // every locale, same reason as `forceLtrInput`.
          ...(prefix !== undefined ? { direction: 'ltr' as const } : {}),
        }}
      >
        {prefix !== undefined ? (
          // `writingDirection` rather than @habba/core's `ltrIsolate`: the
          // affix is a `Text` of its own, so declaring the run's direction is
          // enough, and @habba/ui does not depend on @habba/core — a design
          // system reaching for the domain package to render a plus sign is a
          // coupling that buys nothing here.
          //
          // It is needed: "+966" rendered as "966+", because `+` is
          // bidi-neutral and the app's base direction is RTL, so the algorithm
          // moved it to what it took to be the end of the run.
          <Text
            variant="body"
            tone="muted"
            numeric
            style={{ marginEnd: theme.spacing.sm, writingDirection: 'ltr', textAlign: 'left' }}
          >
            {prefix}
          </Text>
        ) : null}

        <TextInput
          {...rest}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholderTextColor={theme.colors.textSubtle}
          accessibilityLabel={label}
          accessibilityHint={hint}
          style={{
            flex: 1,
            minHeight: theme.minTouchTarget,
            paddingEnd: prefix === undefined ? 0 : theme.spacing.md,
            color: theme.colors.text,
            fontSize: theme.fontSize.base,
            fontFamily: theme.fontFamily.arabic,
            textAlign:
              forceLtrInput || prefix !== undefined ? 'left' : theme.isRtl ? 'right' : 'left',
            writingDirection: forceLtrInput || prefix !== undefined ? 'ltr' : theme.direction,
          }}
        />
      </View>

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
