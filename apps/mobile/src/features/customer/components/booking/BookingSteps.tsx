/**
 * The three-step header the booking flow carries on every screen.
 *
 * A booking is a considered decision made over several screens, unlike the
 * emergency flow where the customer is being carried forward as fast as
 * possible. Knowing how many steps are left is what makes it feel considered
 * rather than open-ended — and it is the same `ProgressStages` the tracking
 * screen uses, so "where am I" looks the same everywhere in the app.
 */

import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton, ProgressStages, Row, Text, useTheme } from '@habba/ui';

export type BookingStep = 0 | 1 | 2;

export interface BookingStepsProps {
  readonly current: BookingStep;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly testID?: string | undefined;
}

export function BookingSteps({ current, title, subtitle, testID }: BookingStepsProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View testID={testID} style={{ gap: theme.spacing.base }}>
      {/* This was the app's only correct back button, implemented here where
          only the booking flow could reach it. It is now `BackButton` in the
          design system, and this is a consumer of it rather than the one place
          that got it right. */}
      <Row gap="sm" align="center">
        {router.canGoBack() ? (
          <BackButton
            testID="booking-back"
            onPress={() => router.back()}
            label={t('common.back')}
          />
        ) : null}

        <Text variant="label" tone="muted" style={{ flex: 1 }}>
          {t('booking.title')}
        </Text>
      </Row>

      <ProgressStages
        testID="booking-progress"
        currentIndex={current}
        stages={[
          { key: 'service', label: t('booking.stepService') },
          { key: 'provider', label: t('booking.stepProvider') },
          { key: 'slot', label: t('booking.stepSlot') },
        ]}
      />

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{title}</Text>
        {subtitle !== undefined ? (
          <Text variant="body" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
