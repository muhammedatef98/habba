/**
 * Empty state.
 *
 * An empty logbook is the FIRST thing most users will see (Phase 1 acceptance:
 * "signs up, adds a vehicle, sees an empty logbook"), so it is a designed
 * screen rather than a blank one. §12: every dead end names a next action.
 *
 * The icon slot takes a glyph or a component. It is decorative and hidden from
 * screen readers — the title already says what the reader needs.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import type { IconName } from './icon-names.js';
import { Text } from './Text.js';
import { useTheme } from './theme.js';

export interface EmptyStateProps {
  readonly title: string;
  readonly body?: string | undefined;
  readonly icon?: ReactNode;
  /** A design-system glyph, drawn in a soft circle — the usual choice over `icon`. */
  readonly iconName?: IconName | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly secondaryActionLabel?: string | undefined;
  readonly onSecondaryAction?: (() => void) | undefined;
  readonly testID?: string;
}

export function EmptyState({
  title,
  body,
  icon,
  iconName,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  testID,
}: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      style={{
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.xl,
        paddingHorizontal: theme.spacing.base,
      }}
    >
      {iconName !== undefined ? (
        <View
          accessible={false}
          style={{
            width: 64,
            height: 64,
            borderRadius: theme.radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.primarySubtle,
          }}
        >
          <Icon name={iconName} size={28} color={theme.colors.primary} />
        </View>
      ) : icon !== undefined ? (
        <View accessible={false} style={{ opacity: 0.9 }}>
          {icon}
        </View>
      ) : null}

      <Text variant="heading" align="center">
        {title}
      </Text>

      {body !== undefined ? (
        <Text variant="body" tone="muted" align="center">
          {body}
        </Text>
      ) : null}

      {actionLabel !== undefined && onAction !== undefined ? (
        <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
          <Button testID={`${testID ?? 'empty'}-action`} label={actionLabel} onPress={onAction} />
          {secondaryActionLabel !== undefined && onSecondaryAction !== undefined ? (
            <Button
              testID={`${testID ?? 'empty'}-secondary`}
              label={secondaryActionLabel}
              variant="ghost"
              onPress={onSecondaryAction}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
