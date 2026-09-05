/**
 * Vertical event timeline — the dispatch log and the in-progress job steps.
 *
 * §9.1 prefers this over a spinner: a list that visibly grows tells the user
 * something is happening, where an indeterminate spinner tells them nothing.
 * The rail is drawn per-item rather than as one absolute line so that rows can
 * be any height, including rows carrying photo strips.
 */

import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { Text } from './Text.js';
import { rowDirectionFor } from './direction.js';
import { useTheme } from './theme.js';

export type TimelineState = 'done' | 'current' | 'pending';

export interface TimelineItem {
  readonly key: string;
  readonly title: string;
  readonly detail?: string | undefined;
  /** Pre-formatted for the active locale — this component does no formatting. */
  readonly timestamp?: string | undefined;
  readonly state: TimelineState;
  readonly children?: ReactNode;
}

export interface TimelineListProps {
  readonly items: readonly TimelineItem[];
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function TimelineList({ items, style, testID }: TimelineListProps) {
  const theme = useTheme();

  return (
    <View testID={testID} style={style}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const dotColor =
          item.state === 'done'
            ? theme.colors.success
            : item.state === 'current'
              ? theme.colors.accent
              : theme.colors.borderStrong;

        return (
          <View
            key={item.key}
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              gap: theme.spacing.md,
            }}
          >
            <View style={{ width: 24, alignItems: 'center' }}>
              <View
                style={{
                  width: 12,
                  height: 12,
                  marginTop: 5,
                  borderRadius: theme.radius.full,
                  backgroundColor: item.state === 'pending' ? 'transparent' : dotColor,
                  borderWidth: item.state === 'pending' ? 2 : 0,
                  borderColor: theme.colors.borderStrong,
                }}
              />
              {!isLast ? (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    minHeight: theme.spacing.lg,
                    backgroundColor:
                      item.state === 'done' ? theme.colors.successBorder : theme.colors.border,
                  }}
                />
              ) : null}
            </View>

            <View style={{ flex: 1, paddingBottom: isLast ? 0 : theme.spacing.base }}>
              <Text
                variant="bodyStrong"
                tone={
                  item.state === 'pending'
                    ? 'muted'
                    : item.state === 'current'
                      ? 'warning'
                      : 'default'
                }
              >
                {item.title}
              </Text>
              {item.detail !== undefined ? (
                <Text variant="caption" tone="muted" style={{ marginTop: 3 }}>
                  {item.detail}
                </Text>
              ) : null}
              {item.children}
              {item.timestamp !== undefined ? (
                <Text
                  variant="caption"
                  tone="subtle"
                  numeric
                  style={{
                    marginTop: 3,
                    fontSize: theme.fontSize.xs,
                  }}
                >
                  {item.timestamp}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
