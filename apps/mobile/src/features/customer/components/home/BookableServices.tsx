/**
 * «احجز خدمة» — the booking flow's front door, as the services themselves.
 *
 * Booking used to be one card that described what could be booked («صيانة
 * دورية، فحص، أو ورشة…»), so finding out whether an oil change was one of
 * them cost a tap and a screen. Showing the services, with the price each
 * starts from, answers that on the home screen, and a tap lands on the
 * booking screen with the service already chosen — one decision fewer.
 *
 * A two-by-two grid rather than a sideways scroller: four cards are all a
 * thumb needs here, a grid has no reading direction to get wrong on the first
 * Arabic launch, and «كل الخدمات» covers the rest.
 */

import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, Row, Text, useTheme } from '@habba/ui';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { priceWithVat } from '@/features/shared/lib/order-price';
import { serviceIcon } from '@/features/shared/lib/service-icon';
import { shortServiceName } from '@/features/shared/lib/service-label';
import type { Service } from '@/features/shared/data/types';

const SHOWN = 4;

export interface BookableServicesProps {
  readonly services: readonly Service[];
  readonly onSelect: (service: Service) => void;
  readonly testID?: string | undefined;
}

export function BookableServices({ services, onSelect, testID }: BookableServicesProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');
  const shown = services.slice(0, SHOWN);

  if (shown.length === 0) return null;

  // Pairs, so each row is a <Row> and follows the reading direction.
  const rows: Service[][] = [];
  for (let index = 0; index < shown.length; index += 2) rows.push(shown.slice(index, index + 2));

  return (
    <View testID={testID} style={{ gap: theme.spacing.sm }}>
      {rows.map((pair) => (
        <Row key={pair.map((service) => service.id).join('-')} gap="sm" align="stretch">
          {pair.map((service) => {
            const name = isArabic ? service.nameAr : service.nameEn;
            // What the customer pays, VAT included — the same figure the
            // booking summary and the card hold will show.
            const price =
              service.basePrice === null
                ? null
                : t('home.priceFrom', {
                    amount: formatSarDisplay(priceWithVat(service.basePrice)),
                  });
            return (
              <Pressable
                key={service.id}
                testID={`home-book-${service.id}`}
                onPress={() => onSelect(service)}
                accessibilityRole="button"
                accessibilityLabel={price === null ? name : `${name} — ${price}`}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.mode === 'dark' ? theme.colors.border : 'transparent',
                    shadowColor: '#000',
                    ...theme.elevation.sm,
                  },
                  pressed ? { opacity: 0.9, transform: [{ scale: 0.98 }] } : null,
                ]}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.colors.accentSubtle,
                  }}
                >
                  <Icon
                    name={serviceIcon(service.icon)}
                    size={theme.iconSize.md}
                    color={theme.colors.accentFg}
                  />
                </View>
                <Text variant="bodyStrong" numberOfLines={2}>
                  {shortServiceName(name)}
                </Text>
                {price !== null ? (
                  <Text variant="caption" tone="muted" numeric>
                    {price}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
          {/* An odd last row keeps its card half-width instead of stretching. */}
          {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </Row>
      ))}
    </View>
  );
}
