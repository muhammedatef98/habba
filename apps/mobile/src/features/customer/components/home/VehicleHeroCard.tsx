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
import { PlateBadge } from '@/features/customer/components/PlateBadge';
import { describeVehicleModel, vehicleLabel } from '@/features/shared/lib/vehicle-label';
import { formatCount } from '@/features/shared/lib/format-number';
import type { Vehicle, VehicleMake, VehicleModel } from '@/features/shared/data/types';

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
  /**
   * What this car needs next, if anything (a maintenance alert). Inside the
   * car's card rather than a banner of its own: on its own it sat between
   * the booking card and «سيارتك», about a car the screen had not shown yet.
   */
  readonly alert?: { readonly message: string; readonly detail?: string | undefined } | undefined;
  readonly onAlertPress?: (() => void) | undefined;
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
  alert,
  onAlertPress,
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
      {/* Not one big button: the switcher and the alert are buttons of their
          own, and a button inside a button is one a screen reader cannot
          reach (and invalid wherever this renders as HTML). The car's details
          open the logbook; so does the row that says so. */}
      <Card
        {...(testID !== undefined ? { testID } : {})}
        elevation="sm"
        style={{ borderRadius: theme.radius.lg, padding: theme.spacing.lg, gap: theme.spacing.md }}
      >
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            alignItems: 'flex-start',
            gap: theme.spacing.md,
          }}
        >
          <Pressable
            testID="home-vehicle-open"
            onPress={onOpenLogbook}
            accessibilityRole="button"
            accessibilityLabel={`${vehicleLabel(selected, sources)} — ${t('home.openLogbook')}`}
            style={{ flex: 1, gap: 2 }}
          >
            <Text variant="heading" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="bodySmall" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          </Pressable>

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

        {/* Tappable for thumbs, silent for screen readers: the title above
            is the same destination, already announced. */}
        <Pressable onPress={onOpenLogbook} accessible={false} style={{ gap: theme.spacing.md }}>
          {plate !== null ? <PlateBadge testID="vehicle-plate" plate={plate} /> : null}

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
        </Pressable>

        {alert !== undefined ? (
          <Pressable
            testID="home-maintenance-alert"
            onPress={onAlertPress}
            accessibilityRole="button"
            accessibilityLabel={`${alert.message} — ${t('home.bookNow')}`}
            style={({ pressed }) => [
              {
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.warningSubtle,
                borderWidth: 1,
                borderColor: theme.colors.warningBorder,
              },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <Icon name="alert" size={theme.iconSize.md} color={theme.colors.warningFg} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                variant="bodySmall"
                tone="warning"
                style={{ fontWeight: theme.fontWeight.semibold }}
              >
                {alert.message}
              </Text>
              {alert.detail !== undefined ? (
                <Text variant="caption" tone="muted" numeric>
                  {alert.detail}
                </Text>
              ) : null}
            </View>
            <Text variant="label" tone="warning">
              {t('home.bookNow')}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          testID="home-open-logbook"
          onPress={onOpenLogbook}
          accessibilityRole="button"
          style={({ pressed }) => [
            {
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              alignItems: 'center',
              gap: theme.spacing.xs,
              minHeight: theme.minTouchTarget,
            },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <Text variant="label" tone="primary" style={{ flex: 1 }}>
            {t('home.openLogbook')}
          </Text>
          <Icon name="chevronForward" size={theme.iconSize.sm} color={theme.colors.primary} />
        </Pressable>
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
                  // Compact in the switcher: one line, so a four-car list does
                  // not become four stacked plates.
                  <PlateBadge plate={vehicle.plateNormalised} variant="compact" />
                ) : null}
              </Card>
            ))}
        </View>
      ) : null}
    </View>
  );
}
