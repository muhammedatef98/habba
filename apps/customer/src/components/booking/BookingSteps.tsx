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
import { Icon, ProgressStages, Text, useTheme } from '@habba/ui';
import { Pressable } from 'react-native';

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        {router.canGoBack() ? (
          <Pressable
            testID="booking-back"
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={({ pressed }) => [
              {
                width: 36,
                height: 36,
                borderRadius: theme.radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surfaceSunken,
              },
              pressed ? { opacity: 0.6 } : null,
            ]}
          >
            {/* Points the way back, which in an RTL layout is where this glyph
                already points — see the note in ActiveOrderCard. */}
            <Icon name="chevronBack" size={theme.iconSize.sm} color={theme.colors.text} />
          </Pressable>
        ) : null}

        <Text variant="label" tone="muted" style={{ flex: 1 }}>
          {t('booking.title')}
        </Text>
      </View>

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
