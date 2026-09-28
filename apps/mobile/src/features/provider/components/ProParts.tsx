/**
 * Small pieces the technician's screens share: stars, the initial badge, a
 * section heading, and a stat tile.
 *
 * Kept in provider/ rather than packages/ui because each one carries a
 * provider decision — the stars round to the half the customer sees, the
 * badge is the business's initial, not the person's.
 */

import { View } from 'react-native';
import { Icon, Row, Text, useTheme, type IconName } from '@habba/ui';

/**
 * The deep petrol of the hero cards, fixed in both themes: white type on it
 * reads the same in light and dark, where the theme's primary lightens for
 * dark mode and white on it would not.
 */
export const PRO_HERO = '#12514F';

/** Five stars, filled to the nearest whole star. */
export function Stars({ value, size = 14 }: { readonly value: number; readonly size?: number }) {
  const theme = useTheme();
  const filled = Math.round(value);
  return (
    <View accessible accessibilityLabel={`${value.toFixed(1)} / 5`}>
      <Row gap="xs">
        {[1, 2, 3, 4, 5].map((index) => (
          <Icon
            key={index}
            name="star"
            size={size}
            color={index <= filled ? theme.colors.accent : theme.colors.border}
          />
        ))}
      </Row>
    </View>
  );
}

/** The business's initial in a circle: the technician's face in the app. */
export function InitialBadge({
  name,
  size = 48,
  inverse = false,
}: {
  readonly name: string;
  readonly size?: number;
  readonly inverse?: boolean;
}) {
  const theme = useTheme();
  const initial = name.trim().slice(0, 1);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: inverse ? 'rgba(255,255,255,0.16)' : theme.colors.primary,
        borderWidth: inverse ? 1 : 0,
        borderColor: 'rgba(255,255,255,0.35)',
      }}
    >
      {initial.length > 0 ? (
        <Text variant={size >= 56 ? 'title' : 'subheading'} tone="inverse">
          {initial}
        </Text>
      ) : (
        <Icon name="wrench" size={theme.iconSize.md} color={theme.colors.textInverse} />
      )}
    </View>
  );
}

/** A heading over a group, with an optional count or link at the far end. */
export function SectionTitle({
  title,
  trailing,
}: {
  readonly title: string;
  readonly trailing?: string | undefined;
}) {
  return (
    <Row gap="sm" align="baseline">
      <Text variant="subheading" style={{ flex: 1 }}>
        {title}
      </Text>
      {trailing !== undefined ? (
        <Text variant="caption" tone="muted">
          {trailing}
        </Text>
      ) : null}
    </Row>
  );
}

/** One figure with its label and an icon, for a grid of two or three. */
export function StatTile({
  icon,
  value,
  label,
  tone = 'default',
  testID,
}: {
  readonly icon: IconName;
  readonly value: string;
  readonly label: string;
  readonly tone?: 'default' | 'accent';
  readonly testID?: string | undefined;
}) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flex: 1,
        gap: theme.spacing.xs,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: theme.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            tone === 'accent' ? theme.colors.accentSubtle : theme.colors.primarySubtle,
        }}
      >
        <Icon
          name={icon}
          size={theme.iconSize.sm}
          color={tone === 'accent' ? theme.colors.accentFg : theme.colors.primary}
        />
      </View>
      <Text variant="heading" numeric numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
