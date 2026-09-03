/**
 * A predictive maintenance alert on the home screen.
 *
 * §1.4 is the reason this exists: mileage plus service history is what turns a
 * one-off emergency user into a recurring one, and the alert is where that
 * becomes something the owner can act on. The card carries the booking action
 * itself — an alert you have to go hunting to act on is a notification, not a
 * prompt.
 *
 * Amber, never red. §8 reserves red for an emergency already under way, and a
 * service due in 600 km is not one.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { formatCount } from '@/lib/format-number';
import type { MaintenanceAlert } from '@/data/types';

export interface MaintenanceAlertCardProps {
  readonly alert: MaintenanceAlert;
  readonly onBook: () => void;
  readonly testID?: string | undefined;
}

export function MaintenanceAlertCard({ alert, onBook, testID }: MaintenanceAlertCardProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');

  // Deliberately NOT the remaining distance: `messageAr` already says "within
  // 600 km", and repeating it underneath reads as a rendering bug. The useful
  // second line is what the estimate is based on, which is the reading the
  // owner can sanity-check against their own odometer.

  return (
    <Card
      {...(testID !== undefined ? { testID } : {})}
      elevation="none"
      onPress={onBook}
      style={{
        backgroundColor: theme.colors.warningSubtle,
        borderColor: theme.colors.warning,
        borderWidth: 1,
      }}
    >
      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          gap: theme.spacing.md,
          alignItems: 'flex-start',
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accentSubtle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="alert" size={theme.iconSize.md} color={theme.colors.warningFg} />
        </View>

        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text variant="bodyStrong" tone="warning">
            {isArabic ? alert.messageAr : alert.messageEn}
          </Text>

          {alert.estimatedKm !== null ? (
            <Text variant="caption" tone="muted" numeric>
              {t('home.lastReading', { km: formatCount(alert.estimatedKm, i18n.language) })}
            </Text>
          ) : null}

          <Text variant="label" tone="warning">
            {t('home.bookNow')}
          </Text>
        </View>
      </View>
    </Card>
  );
}
