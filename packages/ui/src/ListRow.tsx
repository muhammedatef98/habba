/**
 * List row — a tappable line in a list, with an optional selected state.
 *
 * Two RTL rules are load-bearing here (§8):
 *
 *   - Logical properties only. `paddingStart`/`marginEnd`, never `Left`/`Right`,
 *     so the row mirrors with the layout rather than needing a second style.
 *   - The chevron is a directional icon, so it MUST mirror: it points left in
 *     Arabic and right in English. It is drawn as a character chosen by
 *     direction rather than a mirrored image, because a flipped glyph and a
 *     correct glyph look identical only until someone looks closely.
 *
 * ⚠️ …and then the row itself was laid out with a hand-written
 * `flexDirection: 'row'`, which is the one thing `direction.ts` exists to stop.
 * Yoga resolves that against `I18nManager.isRTL`, which `forceRTL` only changes
 * on the NEXT process start — so on a first Arabic launch, and for one session
 * after any language switch, every list row in the app ran left-to-right while
 * the chevron inside it was picked from the *locale* and pointed the other way.
 * A row with its leading icon on the wrong side and a `‹` at the far right is
 * the most visible RTL bug the app had, and it was in the primitive rather than
 * in any one screen. Resolved against both directions now, like everything else.
 */

import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { rowDirectionFor } from './direction.js';
import { haptic } from './haptics.js';
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
        <Text variant="body" tone="subtle" accessible={false}>
          {theme.isRtl ? '‹' : '›'}
        </Text>
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
      // Same signal `Card` fires: a row is a way into something, and choosing
      // one should feel like a selection rather than a commitment.
      onPressIn={() => haptic('selection')}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [base, pressed ? { opacity: 0.9 } : null]}
    >
      {content}
    </Pressable>
  );
}
