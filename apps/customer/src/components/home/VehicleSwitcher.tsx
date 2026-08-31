/**
 * The header pill on design screen 01 — which car this is all about.
 *
 * Collapsed it shows initials, the model and the plate. Tapping expands an
 * inline list rather than opening a modal: with two or three cars a modal is
 * more ceremony than the choice deserves, and the home screen is where someone
 * lands mid-emergency.
 *
 * The plate is shown because that is how people actually identify their own
 * car — two silver Camrys in a household are told apart by the plate and
 * nothing else.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, Text, useTheme } from '@habba/ui';
import { vehicleLabel, describeVehicleModel } from '@/lib/vehicle-label';
import type { Vehicle, VehicleMake, VehicleModel } from '@/data/types';

export interface VehicleSwitcherProps {
  readonly vehicles: readonly Vehicle[];
  readonly selected: Vehicle;
  readonly makes: readonly VehicleMake[] | undefined;
  readonly models: readonly VehicleModel[] | undefined;
  readonly onSelect: (vehicleId: string) => void;
  readonly testID?: string | undefined;
}

export function VehicleSwitcher({
  vehicles,
  selected,
  makes,
  models,
  onSelect,
  testID,
}: VehicleSwitcherProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const sources = { makes, models, isArabic: i18n.language.startsWith('ar') };
  const described = describeVehicleModel(selected, sources);
  const plate = selected.plateAr ?? selected.plateEn;

  // A pill for one car is a control with nothing to control.
  const switchable = vehicles.length > 1;

  const initials = (vehicle: Vehicle) => {
    const name = describeVehicleModel(vehicle, sources) || vehicleLabel(vehicle, sources);
    return name.trim().slice(0, 2);
  };

  return (
    <View testID={testID} style={{ gap: theme.spacing.sm }}>
      <Card
        elevation="none"
        {...(switchable ? { onPress: () => setOpen((value) => !value) } : {})}
        accessibilityLabel={described}
        style={{
          alignSelf: 'flex-start',
          borderRadius: theme.radius.full,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.primarySubtle,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" tone="primary">
              {initials(selected)}
            </Text>
          </View>

          <View>
            <Text variant="bodyStrong">
              {described.length > 0
                ? `${described} ${selected.year}`
                : vehicleLabel(selected, sources)}
            </Text>
            {plate !== null ? (
              <Text variant="caption" tone="muted" numeric>
                {plate}
              </Text>
            ) : null}
          </View>

          {switchable ? (
            <Icon name="chevronDown" size={theme.iconSize.sm} color={theme.colors.textMuted} />
          ) : null}
        </View>
      </Card>

      {open ? (
        <View style={{ gap: theme.spacing.xs }}>
          {vehicles
            .filter((vehicle) => vehicle.id !== selected.id)
            .map((vehicle) => (
              <Card
                key={vehicle.id}
                testID={`vehicle-switch-${vehicle.id}`}
                elevation="none"
                onPress={() => {
                  onSelect(vehicle.id);
                  setOpen(false);
                }}
                style={{
                  alignSelf: 'flex-start',
                  borderRadius: theme.radius.full,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  backgroundColor: theme.colors.surfaceSunken,
                  borderColor: theme.colors.border,
                  borderWidth: 1,
                }}
              >
                <Text variant="bodySmall" tone="muted">
                  {vehicleLabel(vehicle, sources)}
                </Text>
              </Card>
            ))}
          <Text variant="caption" tone="subtle">
            {t('vehicle.myVehicles')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
