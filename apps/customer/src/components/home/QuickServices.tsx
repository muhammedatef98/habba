/**
 * The four most common emergencies, one tap from the home screen.
 *
 * This is not decoration on top of the hero — it removes a screen. The hero
 * opens the flow at "what happened?"; these tiles answer that question on the
 * way in and land on the location step directly, which is the difference
 * between three taps and two for the calls people actually make.
 *
 * Price is deliberately absent. It is fixed and shown on the service screen and
 * again before anything is committed (§11), and an 86dp tile is not where a
 * number the customer is meant to read carefully belongs.
 *
 * No price, no count, no "busy" badge — nothing here is invented. The tiles
 * show the catalogue and nothing the catalogue does not know.
 */

import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme } from '@habba/ui';
import { serviceIcon } from '@/lib/service-icon';
import type { Service } from '@/data/types';

/** Four fits one thumb-width row at 375dp without the names truncating. */
const MAX_TILES = 4;

export interface QuickServicesProps {
  readonly services: readonly Service[];
  readonly onSelect: (service: Service) => void;
  readonly isArabic: boolean;
  readonly testID?: string | undefined;
}

export function QuickServices({ services, onSelect, isArabic, testID }: QuickServicesProps) {
  const theme = useTheme();
  const shown = services.slice(0, MAX_TILES);

  if (shown.length === 0) return null;

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      {shown.map((service) => {
        const name = isArabic ? service.nameAr : service.nameEn;

        return (
          <Pressable
            key={service.id}
            testID={`home-quick-${service.id}`}
            onPress={() => onSelect(service)}
            accessibilityRole="button"
            accessibilityLabel={name}
            style={({ pressed }) => [
              {
                flex: 1,
                minHeight: theme.minTouchTarget + theme.spacing.lg,
                alignItems: 'center',
                gap: theme.spacing.sm,
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.xs,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.mode === 'dark' ? theme.colors.border : 'transparent',
                shadowColor: '#000',
                ...theme.elevation.sm,
              },
              pressed ? { opacity: 0.9, transform: [{ scale: 0.97 }] } : null,
            ]}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.primarySubtle,
              }}
            >
              <Icon
                name={serviceIcon(service.icon)}
                size={theme.iconSize.md}
                color={theme.colors.primary}
              />
            </View>

            <Text variant="caption" align="center" numberOfLines={2}>
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
