/**
 * Step 1 — what, for which car, and where.
 *
 * A list, not the emergency flow's grid. The emergency grid optimises for one
 * thumb and no reading; here the customer is choosing between comparable
 * services and wants the price and the duration before they commit, which is a
 * row's worth of information rather than a tile's.
 *
 * Mode is on this screen rather than its own, because for half the catalogue
 * there is no choice to make: a brake job needs a lift and can only ever
 * happen in a workshop. Presenting that as a step would be a screen whose only
 * content is a disabled option. Where the service supports one mode it is
 * selected and the reason is stated; where it supports both, two chips.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, Icon, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { BookingSteps } from '@/components/booking/BookingSteps';
import { repository } from '@/data/repository';
import { serviceIcon } from '@/lib/service-icon';
import { formatSarDisplay } from '@/lib/money-format';
import { vehicleLabel } from '@/lib/vehicle-label';
import { useBookingDraft } from '@/state/booking-draft';
import { useSession } from '@/state/session';
import type { BookingMode, Service } from '@/data/types';

const BOOKING_MODES: readonly BookingMode[] = ['mobile_scheduled', 'workshop'];

/** The single mode a service supports, or null when it supports both. */
function onlyMode(service: Service): BookingMode | null {
  const bookable = service.supportedModes.filter((mode): mode is BookingMode =>
    (BOOKING_MODES as readonly string[]).includes(mode),
  );
  return bookable.length === 1 ? (bookable[0] as BookingMode) : null;
}

export default function BookingServiceScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');

  const draft = useBookingDraft();
  const homeVehicleId = useSession((state) => state.selectedVehicleId);

  const services = useQuery({
    queryKey: ['bookable-services'],
    queryFn: () => repository.listBookableServices(),
  });

  const vehicles = useQuery({ queryKey: ['vehicles'], queryFn: () => repository.listVehicles() });
  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const models = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => repository.listAllModels(),
  });

  const service = draft.service;
  const available = service?.supportedModes.filter((mode): mode is BookingMode =>
    (BOOKING_MODES as readonly string[]).includes(mode),
  );

  // One supported mode is not a choice, so it is made rather than asked. In an
  // effect because it is a consequence of the selection, and doing it during
  // render would set state while rendering.
  useEffect(() => {
    if (available?.length === 1 && draft.mode !== available[0]) {
      draft.selectMode(available[0] as BookingMode);
    }
  }, [available, draft]);

  const effectiveVehicleId = draft.vehicleId ?? homeVehicleId;
  const needsVehicle = service?.requiresVehicle ?? false;
  const canContinue =
    service !== null && draft.mode !== null && (!needsVehicle || effectiveVehicleId !== null);

  const sources = { makes: makes.data, models: models.data, isArabic };

  function handleContinue() {
    if (service === null || draft.mode === null) return;
    if (needsVehicle && effectiveVehicleId === null) return;
    if (effectiveVehicleId !== null) draft.selectVehicle(effectiveVehicleId);
    router.push('/booking/provider');
  }

  return (
    <Screen scrollable>
      <BookingSteps
        current={0}
        title={t('booking.serviceHeadline')}
        subtitle={t('booking.serviceSubhead')}
      />

      {/* An unreachable catalogue renders as a screen with no services on it,
          which reads as "Habba does not do anything" rather than "try again". */}
      {services.isError ? (
        <ErrorState
          testID="booking-services-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={services.isFetching}
          onRetry={() => void services.refetch()}
        />
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        {services.data?.map((option) => {
          const selected = service?.id === option.id;

          return (
            <Card
              key={option.id}
              testID={`booking-service-${option.id}`}
              elevation={selected ? 'sm' : 'none'}
              onPress={() => draft.selectService(option)}
              accessibilityLabel={isArabic ? option.nameAr : option.nameEn}
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                alignItems: 'center',
                gap: theme.spacing.md,
                backgroundColor: selected ? theme.colors.primarySubtle : theme.colors.surface,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                borderWidth: selected ? 1.5 : 1,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? theme.colors.surface : theme.colors.surfaceSunken,
                }}
              >
                <Icon
                  name={serviceIcon(option.icon)}
                  size={theme.iconSize.md}
                  color={selected ? theme.colors.primary : theme.colors.textMuted}
                />
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{isArabic ? option.nameAr : option.nameEn}</Text>

                {/* `services.description_ar` has no English counterpart in the
                    schema, so the English list would otherwise carry nothing
                    but a name — including for the one service that can only
                    happen in a workshop. That constraint is structured data
                    (`supported_modes`), so it is stated from the data rather
                    than left to a description only half the audience can read. */}
                {option.descriptionAr !== null && isArabic ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {option.descriptionAr}
                  </Text>
                ) : null}

                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    flexWrap: 'wrap',
                  }}
                >
                  <Text variant="caption" tone="subtle" numeric>
                    {t('booking.durationMinutes', { minutes: option.estDurationMin })}
                  </Text>
                  {onlyMode(option) !== null ? (
                    <Text variant="caption" tone="muted">
                      {onlyMode(option) === 'workshop'
                        ? t('booking.workshopOnly')
                        : t('booking.mobileOnly')}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Text variant="bodyStrong" tone="accent" numeric>
                {t('common.sar', { amount: formatSarDisplay(option.basePrice) })}
              </Text>
            </Card>
          );
        })}
      </View>

      {service !== null ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('booking.modeLabel')}
          </Text>

          {available?.length === 1 ? (
            <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
              <Text variant="bodySmall" tone="muted">
                {available[0] === 'workshop'
                  ? t('booking.modeLockedWorkshop')
                  : t('booking.modeLockedMobile')}
              </Text>
            </Card>
          ) : (
            <View
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                gap: theme.spacing.sm,
              }}
            >
              {available?.map((mode) => {
                const selected = draft.mode === mode;
                return (
                  <Card
                    key={mode}
                    testID={`booking-mode-${mode}`}
                    elevation="none"
                    onPress={() => draft.selectMode(mode)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      minHeight: theme.minTouchTarget,
                      justifyContent: 'center',
                      backgroundColor: selected
                        ? theme.colors.primarySubtle
                        : theme.colors.surfaceSunken,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderWidth: selected ? 1.5 : 1,
                    }}
                  >
                    <Text variant="bodySmall" tone={selected ? 'primary' : 'muted'} align="center">
                      {mode === 'workshop' ? t('booking.modeWorkshop') : t('booking.modeMobile')}
                    </Text>
                  </Card>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {service !== null && needsVehicle ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('booking.vehicleLabel')}
          </Text>

          {(vehicles.data?.length ?? 0) === 0 ? (
            <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="bodySmall" tone="muted">
                  {t('booking.noVehicle')}
                </Text>
                <Button
                  testID="booking-add-vehicle"
                  label={t('vehicle.addTitle')}
                  size="medium"
                  onPress={() => router.push('/add-vehicle')}
                />
              </View>
            </Card>
          ) : (
            <View
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                flexWrap: 'wrap',
                gap: theme.spacing.sm,
              }}
            >
              {vehicles.data?.map((vehicle) => {
                const selected = effectiveVehicleId === vehicle.id;
                return (
                  <Card
                    key={vehicle.id}
                    testID={`booking-vehicle-${vehicle.id}`}
                    elevation="none"
                    onPress={() => draft.selectVehicle(vehicle.id)}
                    style={{
                      paddingVertical: theme.spacing.sm,
                      paddingHorizontal: theme.spacing.md,
                      borderRadius: theme.radius.full,
                      backgroundColor: selected
                        ? theme.colors.primarySubtle
                        : theme.colors.surfaceSunken,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderWidth: selected ? 1.5 : 1,
                    }}
                  >
                    <Text variant="bodySmall" tone={selected ? 'primary' : 'muted'}>
                      {vehicleLabel(vehicle, sources)}
                    </Text>
                  </Card>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      <Button
        testID="booking-continue"
        label={t('common.continue')}
        onPress={handleContinue}
        disabled={!canContinue}
      />
    </Screen>
  );
}
