/**
 * Booking — Phase 4 (slots, workshops) is not built yet.
 *
 * §11: never present a dead or fake button. This route exists so §9.1's
 * second primary action goes somewhere real and honest rather than being
 * omitted from the home screen or silently doing nothing.
 */

import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';

export default function BookingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Screen scrollable>
      <Text variant="title">{t('booking.title')}</Text>

      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t('booking.comingSoonTitle')}</Text>
          <Text variant="body" tone="muted">
            {t('booking.comingSoonBody')}
          </Text>
        </View>
      </Card>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
