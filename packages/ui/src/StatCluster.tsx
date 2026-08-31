/**
 * A row of two or more figures separated by hairlines — ETA, distance, price.
 *
 * §9.1 requires the price to be visible on every screen of an active job, so
 * this exists to make "show the number" the path of least resistance. Values
 * are rendered with tabular figures: these update live, and proportional
 * digits make the whole row twitch on every tick.
 */

import { Fragment } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { useTheme } from './theme.js';
import { lineHeightFor } from './tokens.js';

export interface StatItem {
  readonly key: string;
  /** Omit when the value is genuinely unknown — the slot renders as a dash. */
  readonly value: string | undefined;
  readonly label: string;
  /** Money and other figures that should read as the accent. */
  readonly emphasis?: 'default' | 'accent';
  readonly flex?: number;
}

export interface StatClusterProps {
  readonly items: readonly StatItem[];
  readonly size?: 'md' | 'lg';
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function StatCluster({ items, size = 'md', style, testID }: StatClusterProps) {
  const theme = useTheme();
  const valueSize = size === 'lg' ? theme.fontSize['2xl'] : theme.fontSize.lg;

  return (
    <View testID={testID} style={[{ flexDirection: 'row', alignItems: 'stretch' }, style]}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? (
            <View
              style={{
                width: 1,
                backgroundColor: theme.colors.border,
                marginHorizontal: theme.spacing.md,
              }}
            />
          ) : null}
          <View style={{ flex: item.flex ?? 1, gap: 3, alignItems: 'center' }}>
            <Text
              variant="heading"
              tone={item.emphasis === 'accent' ? 'accent' : 'primary'}
              style={{
                fontSize: valueSize,
                // Latin ratio regardless of locale: these are always Latin
                // numerals, and the Arabic 1.7 leading leaves the figure
                // floating in its own row.
                lineHeight: lineHeightFor(valueSize, 'latin'),
                fontVariant: ['tabular-nums'],
              }}
            >
              {item.value ?? '—'}
            </Text>
            <Text variant="caption" tone="muted" style={{ fontSize: theme.fontSize.xs }}>
              {item.label}
            </Text>
          </View>
        </Fragment>
      ))}
    </View>
  );
}
