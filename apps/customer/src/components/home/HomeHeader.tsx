/**
 * The first two lines of the app.
 *
 * Deliberately not a card: everything below it is a raised surface, so the
 * header staying flat on the page background is what makes the cards read as
 * layered rather than as one undifferentiated stack. The previous home opened
 * with a bare "سياراتي" title, which named the screen instead of orienting the
 * person on it.
 *
 * The mark sits opposite the greeting at small size — the wordmark belongs to
 * onboarding, where the brand is being introduced. Here it is a bookmark, not
 * a billboard.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HabbaMark, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { greetingKeyNow } from '@/lib/greeting';

export interface HomeHeaderProps {
  /** The customer's name; omitted for a guest, whose "name" is a placeholder. */
  readonly name?: string | undefined;
  readonly testID?: string | undefined;
}

export function HomeHeader({ name, testID }: HomeHeaderProps) {
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

      <HabbaMark size={34} accessibilityLabel="هبّة" />
    </View>
  );
}
