/**
 * Provenance badge — the visual half of ADR-0005.
 *
 * The database refuses to let an owner-typed claim call itself
 * `habba_verified`. This component is the other half of that promise: the two
 * must never look the same, never share a colour, and never share a word.
 *
 * If a future change makes `self_reported` render with the verified treatment,
 * the product starts telling used-car buyers something untrue. The unit test
 * next to this file exists to make that regression loud.
 */

import { View } from 'react-native';
import { Text } from './Text.js';
import { useTheme } from './theme.js';

export type Provenance = 'self_reported' | 'self_documented' | 'habba_verified' | 'third_party';

export interface ProvenanceBadgeProps {
  readonly provenance: Provenance;
  /** Copy comes from @habba/i18n — this component never hardcodes strings. */
  readonly label: string;
}

/** True only for entries Habba itself produced and can stand behind. */
export function isVerifiedProvenance(provenance: Provenance): boolean {
  return provenance === 'habba_verified';
}

export function ProvenanceBadge({ provenance, label }: ProvenanceBadgeProps) {
  const theme = useTheme();
  const verified = isVerifiedProvenance(provenance);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radius.full,
        backgroundColor: verified ? theme.colors.verifiedSubtle : theme.colors.selfReportedSubtle,
        borderWidth: verified ? 1 : 0,
        borderColor: verified ? theme.colors.verified : 'transparent',
      }}
    >
      <Text
        variant="caption"
        style={{
          color: verified ? theme.colors.verified : theme.colors.selfReported,
          fontWeight: verified ? '600' : '400',
        }}
      >
        {label}
      </Text>
    </View>
  );
}
