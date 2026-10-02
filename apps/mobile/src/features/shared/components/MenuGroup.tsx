/**
 * A settings-style list: rows in one card, divided by hairlines, each with its
 * icon in a tinted square.
 *
 * The account tab had each destination in a card of its own, and the legal
 * and support rows as bordered boxes inside a card — a border inside a border.
 * One card per group is what a phone's own settings look like, and it reads
 * as "these belong together" without a heading having to say so.
 */

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Card, Icon, Row, Text, useTheme, type IconName } from '@habba/ui';

export function MenuGroup({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string | undefined;
}) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <Card
      {...(testID !== undefined ? { testID } : {})}
      elevation="none"
      style={{
        paddingVertical: 0,
        paddingHorizontal: 0,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <View
              style={{
                height: 1,
                backgroundColor: theme.colors.border,
                marginHorizontal: theme.spacing.base,
              }}
            />
          ) : null}
          {row}
        </Fragment>
      ))}
    </Card>
  );
}

export interface MenuRowProps {
  readonly icon: IconName;
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** At the far end, before the chevron: a count, a number. */
  readonly value?: string | undefined;
  readonly onPress: () => void;
  readonly tone?: 'default' | 'danger';
  readonly testID?: string | undefined;
}

export function MenuRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  tone = 'default',
  testID,
}: MenuRowProps) {
  const theme = useTheme();
  const danger = tone === 'danger';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        minHeight: theme.minTouchTarget + 8,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.base,
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
      })}
    >
      <Row gap="md">
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: danger ? theme.colors.emergencySubtle : theme.colors.primarySubtle,
          }}
        >
          <Icon
            name={icon}
            size={theme.iconSize.sm}
            color={danger ? theme.colors.emergency : theme.colors.primary}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body" tone={danger ? 'emergency' : 'default'} numberOfLines={1}>
            {title}
          </Text>
          {subtitle !== undefined ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {value !== undefined ? (
          <Text variant="caption" tone="muted" numeric>
            {value}
          </Text>
        ) : null}
        <Icon name="chevronForward" size={theme.iconSize.sm} color={theme.colors.textSubtle} />
      </Row>
    </Pressable>
  );
}
