/**
 * The top of every screen that is not a tab: a back button, and the name of
 * the place the screen belongs to.
 *
 * Screens used to end with a «رجوع» link below everything else, so going back
 * meant scrolling to the bottom first, and the top of the screen carried no
 * sign that it was a step away from somewhere. This is where every phone
 * puts it. `chevronBack` means "go back" and Icon mirrors it, so the arrow
 * points right in Arabic and left in English.
 */

import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, Row, Text, useTheme } from '@habba/ui';
import type { ReactNode } from 'react';

export interface BackBarProps {
  /** The section this screen belongs to, beside the arrow (دفتر السيارة). */
  readonly label?: string | undefined;
  /** Defaults to the previous screen, or home when there is none. */
  readonly onBack?: (() => void) | undefined;
  /** Something for the far end of the bar: a share button, a badge. */
  readonly trailing?: ReactNode;
  readonly testID?: string | undefined;
}

export function goBackOrHome(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function BackBar({ label, onBack, trailing, testID }: BackBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Row gap="sm" testID={testID}>
      <Pressable
        testID={testID !== undefined ? `${testID}-back` : 'back'}
        onPress={onBack ?? goBackOrHome}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: theme.radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon name="chevronBack" size={theme.iconSize.sm} color={theme.colors.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        {label !== undefined ? (
          <Text variant="label" tone="muted" numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Row>
  );
}
