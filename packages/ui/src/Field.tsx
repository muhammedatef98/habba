/**
 * Labelled text input with inline error.
 *
 * CLAUDE.md §12: errors are surfaced to the user in Arabic, plainly, with a
 * next action. That is why `error` is a required-to-consider prop and renders
 * inline next to the field rather than as a toast the user can miss.
 */

import { useState } from 'react';
import {
  PixelRatio,
  Pressable,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { Text } from './Text.js';
import { rowDirectionFor } from './direction.js';
import { scaledHeight } from './font-scale.js';
import { useTheme } from './theme.js';
import { arabicFace } from './tokens.js';

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
  /**
   * Words for the reveal control on a `secureTextEntry` field. Supplying them
   * is what turns the control on.
   *
   * Typing a password blind on a phone keyboard is the most common reason a
   * correct password is rejected, and the cost of a mistyped one is a lockout
   * counter the customer cannot see. Opt-in rather than automatic, because not
   * every masked field wants it — a PIN entered in public does not.
   *
   * The labels are props because @habba/ui carries no copy: a design system
   * that reached for a translation function would be a design system with a
   * locale, which is the app's concern (§2.1).
   */
  readonly revealLabels?: { readonly show: string; readonly hide: string } | undefined;
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
  revealLabels,
  testID,
  ...rest
}: FieldProps) {
  const theme = useTheme();
  const hasError = error !== undefined && error.length > 0;
  const [revealed, setRevealed] = useState(false);
  const showReveal = revealLabels !== undefined && rest.secureTextEntry === true;
  const revealLabel = revealed ? revealLabels?.hide : revealLabels?.show;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>

      <View
        style={{
          // A prefixed field pins itself LTR further down, so it must not be
          // reversed here as well — that would put the dialling code back on
          // the wrong side of the caret.
          flexDirection:
            prefix === undefined ? rowDirectionFor(theme.direction, theme.nativeDirection) : 'row',
          alignItems: 'center',
          minHeight: scaledHeight(theme.minTouchTarget, PixelRatio.getFontScale()),
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
          secureTextEntry={rest.secureTextEntry === true && !revealed}
          style={{
            flex: 1,
            minHeight: scaledHeight(theme.minTouchTarget, PixelRatio.getFontScale()),
            paddingEnd: prefix === undefined || showReveal ? 0 : theme.spacing.md,
            color: theme.colors.text,
            fontSize: theme.fontSize.base,
            fontFamily: arabicFace['400'],
            textAlign:
              forceLtrInput || prefix !== undefined ? 'left' : theme.isRtl ? 'right' : 'left',
            writingDirection: forceLtrInput || prefix !== undefined ? 'ltr' : theme.direction,
          }}
        />

        {showReveal ? (
          <Pressable
            testID={testID === undefined ? undefined : `${testID}-reveal`}
            onPress={() => setRevealed((value) => !value)}
            accessibilityRole="switch"
            accessibilityState={{ checked: revealed }}
            accessibilityLabel={revealLabel ?? ''}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={({ pressed }) => [
              { paddingHorizontal: theme.spacing.md, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text variant="caption" tone="primary">
              {revealLabel}
            </Text>
          </Pressable>
        ) : null}
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
