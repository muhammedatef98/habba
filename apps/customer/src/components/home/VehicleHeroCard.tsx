/**
 * The selected car, as the subject of the home screen rather than a chip on it.
 *
 * §1 says the logbook is the moat and §9.1 says it is the app's soul. The old
 * home gave it a 32dp square of initials in a pill, then repeated every car
 * again as a flat list below — the same information twice, neither time with
 * any weight. This is the consolidation: one card that shows what the logbook
 * actually holds for this car, and opens it.
 *
 * The three figures are the argument for the moat in miniature — how far the
 * car has gone, how much of its life is written down, and when it was last
 * touched. All three come from data the app already has; none is estimated
 * here. Where the logbook is empty the slot renders a dash rather than a
 * plausible-looking zero.
 *
 * The plate gets its own bordered chip because that is how people identify
 * their own car — two silver Camrys in one household are told apart by the
 * plate and nothing else.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, StatCluster, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { describeVehicleModel, vehicleLabel } from '@/lib/vehicle-label';
import { formatCount } from '@/lib/format-number';
import type { Vehicle, VehicleMake, VehicleModel } from '@/data/types';

export interface VehicleHeroCardProps {
  readonly vehicles: readonly Vehicle[];
  readonly selected: Vehicle;
  readonly makes: readonly VehicleMake[] | undefined;
  readonly models: readonly VehicleModel[] | undefined;
  /** Entries in this car's logbook. Undefined while the timeline is loading. */
  readonly recordCount?: number | undefined;
  /** Already-formatted date of the newest service event, if there is one. */
  readonly lastServiceLabel?: string | undefined;
  readonly onOpenLogbook: () => void;
  readonly onSelect: (vehicleId: string) => void;
  readonly testID?: string | undefined;
}

export function VehicleHeroCard({
  vehicles,
  selected,
  makes,
  models,
  recordCount,
  lastServiceLabel,
  onOpenLogbook,
  onSelect,
  testID,
}: VehicleHeroCardProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [switching, setSwitching] = useState(false);

  const isArabic = i18n.language.startsWith('ar');
  const sources = { makes, models, isArabic };
  const described = describeVehicleModel(selected, sources);
  const plate = selected.plateAr ?? selected.plateEn;

  // `describeVehicleModel` returns "" rather than null when the catalogue has
  // not loaded, so this is a length check and not a `??` chain — nullish
  // coalescing would happily print an empty heading.
  const nickname = selected.nickname?.trim() ?? '';
  const title =
    nickname.length > 0
      ? nickname
      : described.length > 0
        ? described
        : vehicleLabel(selected, sources);

  // Without a nickname the title already *is* the make and model, so repeating
  // it underneath ("تويوتا كامري" over "تويوتا كامري · 2024") reads as a
  // rendering bug. The year is the part the second line still adds.
  const subtitle =
    title === described || described.length === 0
      ? String(selected.year)
      : `${described} · ${selected.year}`;

  /**
   * Zero is not a mileage, it is a car nobody has read the odometer on yet —
   * `currentMileage` defaults to 0 when the owner skips it on registration.
   * Printing "0" claims the car has never moved; the dash says what is
   * actually true, which is that we do not know.
   */
  const mileage =
    selected.currentMileage > 0 ? formatCount(selected.currentMileage, i18n.language) : undefined;

  // A switcher for one car is a control with nothing to control.
  const switchable = vehicles.length > 1;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Card
        {...(testID !== undefined ? { testID } : {})}
        elevation="sm"
        onPress={onOpenLogbook}
        accessibilityLabel={`${vehicleLabel(selected, sources)} — ${t('home.openLogbook')}`}
        style={{ borderRadius: theme.radius.lg, padding: theme.spacing.lg, gap: theme.spacing.md }}
      >
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'flex-start',
            gap: theme.spacing.md,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="bodySmall" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>

          {switchable ? (
            <Pressable
              testID="home-vehicle-switcher"
              onPress={() => setSwitching((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel={t('home.switchVehicle')}
              accessibilityState={{ expanded: switching }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={({ pressed }) => [
                {
                  flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  paddingVertical: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.sm,
                  borderRadius: theme.radius.full,
                  backgroundColor: theme.colors.surfaceSunken,
                },
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <Text variant="caption" tone="muted">
                {t('home.switchVehicle')}
              </Text>
              <Icon name="chevronDown" size={theme.iconSize.sm} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {plate !== null ? (
          <View
            style={{
              alignSelf: 'flex-start',
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.sm,
              borderWidth: 1,
              borderColor: theme.colors.borderStrong,
              backgroundColor: theme.colors.surfaceSunken,
            }}
          >
            <Text variant="bodySmall" numeric>
              {plate}
            </Text>
          </View>
        ) : null}

        <View style={{ height: 1, backgroundColor: theme.colors.border }} />

        <StatCluster
          testID="home-vehicle-stats"
          items={[
            { key: 'mileage', value: mileage, label: t('home.statMileage') },
            {
              key: 'records',
              value:
                recordCount === undefined ? undefined : formatCount(recordCount, i18n.language),
              label: t('home.statRecords'),
            },
            { key: 'last', value: lastServiceLabel, label: t('home.statLastService') },
          ]}
        />

        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <Text variant="label" tone="primary" style={{ flex: 1 }}>
            {t('home.openLogbook')}
          </Text>
          <Icon name="chevronForward" size={theme.iconSize.sm} color={theme.colors.primary} />
        </View>
      </Card>

      {switching ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" tone="subtle">
            {t('home.otherVehicles')}
          </Text>
          {vehicles
            .filter((vehicle) => vehicle.id !== selected.id)
            .map((vehicle) => (
              <Card
                key={vehicle.id}
                testID={`vehicle-switch-${vehicle.id}`}
                elevation="none"
                onPress={() => {
                  onSelect(vehicle.id);
                  setSwitching(false);
                }}
                style={{
                  flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                  alignItems: 'center',
                  minHeight: theme.minTouchTarget,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceSunken,
                  borderColor: theme.colors.border,
                  borderWidth: 1,
                }}
              >
                <Text variant="bodySmall" style={{ flex: 1 }} numberOfLines={1}>
                  {vehicleLabel(vehicle, sources)}
                </Text>
                {vehicle.plateNormalised !== null ? (
                  <Text variant="caption" tone="subtle" numeric>
                    {vehicle.plateNormalised}
                  </Text>
                ) : null}
              </Card>
            ))}
        </View>
      ) : null}
    </View>
  );
}
