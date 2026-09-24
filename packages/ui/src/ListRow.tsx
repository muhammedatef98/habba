/**
 * List row — a tappable line in a list, with an optional selected state.
 *
 * Two RTL rules are load-bearing here (§8):
 *
 *   - Logical properties only. `paddingStart`/`marginEnd`, never `Left`/`Right`,
 *     so the row mirrors with the layout rather than needing a second style.
 *   - The chevron is a directional icon, so it MUST mirror: it points left in
 *     Arabic and right in English. It is the same `chevronForward` icon every
 *     other forward row in the app draws, which mirrors by direction.
 */

import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { Icon } from './Icon.js';
import { Text } from './Text.js';
import { rowDirectionFor } from './direction.js';
import { useTheme } from './theme.js';

export interface ListRowProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** Right-aligned in LTR, left-aligned in RTL — a price, a date, a count. */
  readonly value?: string | undefined;
  readonly onPress?: (() => void) | undefined;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly showChevron?: boolean;
  readonly leading?: ReactNode;
  readonly accessibilityLabel?: string | undefined;
  readonly testID?: string;
}

export function ListRow({
  title,
  subtitle,
  value,
  onPress,
  selected = false,
  disabled = false,
  showChevron,
  leading,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const theme = useTheme();
  const interactive = onPress !== undefined && !disabled;
  const chevron = showChevron ?? interactive;

  const base: ViewStyle = {
    minHeight: theme.minTouchTarget,
    // Resolved against the locale and the platform together (direction.ts):
    // a plain `row` put the chevron against the title, at the reading start,
    // on the launch where the two disagree.
    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.base,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: selected ? theme.colors.primary : theme.colors.border,
    backgroundColor: selected ? theme.colors.primarySubtle : theme.colors.surface,
    opacity: disabled ? 0.5 : 1,
  };

  const content = (
    <>
      {leading}

      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <Text variant="body" numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {value !== undefined ? (
        <Text variant="bodyStrong" tone="muted">
          {value}
        </Text>
      ) : null}

      {chevron ? (
        <Icon name="chevronForward" size={theme.iconSize.sm} color={theme.colors.textSubtle} />
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <View testID={testID} style={base} accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [base, pressed ? { opacity: 0.9 } : null]}
    >
      {content}
    </Pressable>
  );
}
