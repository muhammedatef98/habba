/**
 * The first two lines of the app.
 *
 * Deliberately not a card: everything below it is a raised surface, so the
 * header staying flat on the page background is what makes the cards read as
 * layered rather than as one undifferentiated stack. The previous home opened
 * with a bare "سياراتي" title, which named the screen instead of orienting the
 * person on it.
 *
 * Opposite the greeting: the person's initial, which opens their account. It
 * was the brand mark — decoration in the one corner every app teaches people
 * to reach for their profile. The brand is on the icon they tapped to get here.
 */

import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { greetingKeyNow } from '@/features/shared/lib/greeting';

export interface HomeHeaderProps {
  /** The customer's name; omitted for a guest, whose "name" is a placeholder. */
  readonly name?: string | undefined;
  readonly onAccount: () => void;
  readonly testID?: string | undefined;
}

export function HomeHeader({ name, onAccount, testID }: HomeHeaderProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const greeting = t(`home.${greetingKeyNow()}`);

  return (
    <View
      testID={testID}
      style={{
        flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="bodySmall" tone="muted">
          {greeting}
        </Text>
        {name !== undefined && name.length > 0 ? (
          <Text variant="title" numberOfLines={1}>
            {name}
          </Text>
        ) : null}
      </View>

      <Pressable
        testID="home-account"
        onPress={onAccount}
        accessibilityRole="button"
        accessibilityLabel={t('nav.account')}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={({ pressed }) => [
          {
            width: 44,
            height: 44,
            borderRadius: theme.radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.primarySubtle,
            borderWidth: 1,
            borderColor: theme.colors.border,
          },
          pressed ? { opacity: 0.8 } : null,
        ]}
      >
        {name !== undefined && name.trim().length > 0 ? (
          <Text variant="subheading" tone="primary">
            {name.trim().slice(0, 1)}
          </Text>
        ) : (
          <Icon name="person" size={theme.iconSize.md} color={theme.colors.primary} />
        )}
      </Pressable>
    </View>
  );
}
