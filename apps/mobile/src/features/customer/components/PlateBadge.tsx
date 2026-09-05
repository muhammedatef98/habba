/**
 * A Saudi plate, rendered the way the plate itself is.
 *
 * CLAUDE.md §5: "3 Arabic letters + 4 digits, with the Latin-letter equivalent
 * (e.g. `أ ب ج ١٢٣٤` / `A B J 1234`). Store both, search both." Both halves
 * were stored and searched from the start; only one was ever shown, and the
 * Latin one was shown as its own search key — `ABJ1234`, unspaced — which is a
 * database value, not a plate.
 *
 * Showing both is not decoration. A physical Saudi plate carries the two
 * scripts stacked, and a customer checking that the app has the right car
 * checks it against the metal in front of them. Matching the object is the
 * whole job of this component.
 *
 * Arabic-Indic digits on the Arabic line, deliberately against §8's
 * Latin-numerals default: the plate is the narrow case `toArabicIndicDigits`
 * exists for, because the digits are being reproduced rather than counted.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { parsePlate, toArabicIndicDigits } from '@habba/core';
import { Text, useTheme } from '@habba/ui';

export interface PlateBadgeProps {
  /** Any stored form — Arabic, Latin, or the normalised key. */
  readonly plate: string;
  /** `full` stacks both scripts; `compact` is one line, for dense lists. */
  readonly variant?: 'full' | 'compact';
  readonly testID?: string | undefined;
}

export function PlateBadge({ plate, variant = 'full', testID }: PlateBadgeProps) {
  const theme = useTheme();
  const parsed = parsePlate(plate);

  // An unparseable plate is still the customer's plate: it was accepted at
  // entry, so it is shown as typed rather than hidden behind a validator that
  // has changed its mind since.
  if (!parsed.ok) {
    return (
      <Badge testID={testID}>
        <Text variant="bodySmall" numeric>
          {plate}
        </Text>
      </Badge>
    );
  }

  const { lettersAr, lettersEn, digits } = parsed.plate;
  const arabicLine = `${[...lettersAr].join(' ')} ${toArabicIndicDigits(digits)}`;
  const latinLine = `${[...lettersEn].join(' ')} ${digits}`;

  if (variant === 'compact') {
    return (
      <Badge testID={testID}>
        <Text variant="caption" tone="subtle" numeric>
          {latinLine}
        </Text>
      </Badge>
    );
  }

  return (
    <Badge testID={testID}>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text variant="bodySmall" align="center">
          {arabicLine}
        </Text>
        {/* The separating rule is on the real plate too. */}
        <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: theme.colors.border }} />
        <Text variant="caption" tone="muted" align="center" numeric>
          {latinLine}
        </Text>
      </View>
    </Badge>
  );
}

function Badge({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string | undefined;
}) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      style={{
        alignSelf: 'flex-start',
        paddingVertical: theme.spacing.xs,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors.borderStrong,
        backgroundColor: theme.colors.surfaceSunken,
      }}
    >
      {children}
    </View>
  );
}
