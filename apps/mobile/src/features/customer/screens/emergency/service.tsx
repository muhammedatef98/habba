/**
 * Screen 02 — what happened?
 *
 * A grid of five services, not a list: the design's target is three taps from
 * home to a dispatched technician, and a grid puts every option in one
 * thumb-reachable screenful. Prices come from the catalogue and are shown
 * before the customer commits — §11 fixes emergency prices centrally, so this
 * number is a promise the system can keep, not an estimate.
 */

import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ErrorState,
  Icon,
  Row,
  Screen,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useEmergencyDraft } from '@/features/shared/state/emergency-draft';
import { useSession } from '@/features/shared/state/session';
import { serviceIcon } from '@/features/shared/lib/service-icon';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { priceWithVat } from '@/features/shared/lib/order-price';
import { describeVehicleModel, vehicleLabel } from '@/features/shared/lib/vehicle-label';

export default function ServiceSelectionScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');

  const service = useEmergencyDraft((state) => state.service);
  const vehicleId = useEmergencyDraft((state) => state.vehicleId);
  const selectService = useEmergencyDraft((state) => state.selectService);
  const selectVehicle = useEmergencyDraft((state) => state.selectVehicle);

  // Prefilled from the home screen's selection: someone who just looked at a
  // maintenance alert for one car and hit the emergency button is almost
  // certainly calling about that car, and re-asking is a step for nothing.
  const homeVehicleId = useSession((state) => state.selectedVehicleId);

  const services = useQuery({
    queryKey: ['emergency-services'],
    queryFn: () => repository.listEmergencyServices(),
  });

  // Needed only to name the vehicle chips. Same query keys as the home screen,
  // so this is a cache hit rather than a second round trip.
  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const allModels = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => repository.listAllModels(),
  });

  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => repository.listVehicles(),
  });

  // Effective selection: whatever the draft holds, else the home screen's car,
  // else the first one. Most owners have one car, and making them tap it
  // before "continue" wakes up is a step for nothing in an emergency — the
  // chip shows which car is chosen, and another is one tap away.
  const effectiveVehicleId = vehicleId ?? homeVehicleId ?? vehicles.data?.[0]?.id ?? null;
  const requiresVehicle = service?.requiresVehicle ?? false;
  const canContinue = service !== null && (!requiresVehicle || effectiveVehicleId !== null);

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('emergency.serviceHeadline')}</Text>
        <Text variant="body" tone="muted">
          {t('emergency.serviceSubhead')}
        </Text>
      </View>

      {/* This is the emergency flow: an empty grid here means a stranded
          customer being shown nothing at all, with no way to tell whether the
          app is broken or simply has no help to offer. */}
      {services.isError ? (
        <ErrorState
          testID="emergency-services-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={services.isFetching}
          onRetry={() => void services.refetch()}
        />
      ) : null}

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          flexWrap: 'wrap',
          gap: theme.spacing.md,
        }}
      >
        {services.data?.map((option) => {
          const isSelected = service?.id === option.id;
          return (
            <Card
              selected={isSelected}
              key={option.id}
              testID={`emergency-service-${option.id}`}
              elevation={isSelected ? 'md' : 'none'}
              onPress={() => selectService(option)}
              accessibilityLabel={isArabic ? option.nameAr : option.nameEn}
              style={{
                // Two per row, with the gap accounted for. minWidth keeps the
                // card usable if a long service name wraps.
                flexBasis: '47%',
                flexGrow: 1,
                minHeight: 112,
                justifyContent: 'space-between',
                borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                borderWidth: isSelected ? 1.5 : 1,
                backgroundColor: isSelected ? theme.colors.primarySubtle : theme.colors.surface,
              }}
            >
              <Row justify="space-between" align="flex-start">
                <Icon
                  name={serviceIcon(option.icon)}
                  size={theme.iconSize['2xl']}
                  color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                />
                {isSelected ? (
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="check" size={theme.iconSize.sm} color={theme.colors.textInverse} />
                  </View>
                ) : null}
              </Row>
              <View style={{ gap: theme.spacing.xs }}>
                <Text variant="subheading">{isArabic ? option.nameAr : option.nameEn}</Text>
                {/* The catalogue's descriptions are Arabic only. */}
                {isArabic && option.descriptionAr !== null ? (
                  <Text variant="caption" tone="muted">
                    {option.descriptionAr}
                  </Text>
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>

      {requiresVehicle ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('vehicle.myVehicles')}
          </Text>
          {/* No car on file left a heading over nothing and a continue button
              that never woke up — a dead end, on the one screen where the
              person reading it may be stranded. */}
          {vehicles.isSuccess && vehicles.data.length === 0 ? (
            <Card
              testID="emergency-no-vehicle"
              elevation="none"
              style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.sm }}
            >
              <Text variant="bodyStrong">{t('home.noVehicleTitle')}</Text>
              <Text variant="bodySmall" tone="muted">
                {t('home.noVehicleBody')}
              </Text>
              <Button
                testID="emergency-add-vehicle"
                label={t('vehicle.addTitle')}
                size="medium"
                onPress={() => router.push({ pathname: '/add-vehicle', params: { then: 'back' } })}
              />
            </Card>
          ) : null}
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              flexWrap: 'wrap',
              gap: theme.spacing.sm,
            }}
          >
            {vehicles.data?.map((vehicle) => {
              const isSelected = effectiveVehicleId === vehicle.id;
              return (
                <Card
                  selected={isSelected}
                  key={vehicle.id}
                  testID={`emergency-vehicle-${vehicle.id}`}
                  elevation={isSelected ? 'md' : 'none'}
                  onPress={() => selectVehicle(vehicle.id)}
                  style={{
                    gap: 2,
                    borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                    borderWidth: isSelected ? 1.5 : 1,
                    backgroundColor: isSelected ? theme.colors.primarySubtle : theme.colors.surface,
                  }}
                >
                  {/* Make and model first — "which car" is answered by the
                      car, not by its plate — then the owner's own name for
                      it or the plate underneath. */}
                  <Text variant="bodyStrong" tone={isSelected ? 'primary' : 'default'}>
                    {describeVehicleModel(vehicle, {
                      makes: makes.data,
                      models: allModels.data,
                      isArabic,
                    }) ||
                      vehicleLabel(vehicle, {
                        makes: makes.data,
                        models: allModels.data,
                        isArabic,
                      })}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {vehicleLabel(vehicle, {
                      makes: makes.data,
                      models: allModels.data,
                      isArabic,
                    })}
                  </Text>
                </Card>
              );
            })}
          </View>
        </View>
      ) : null}

      {service !== null ? (
        // Stacked, not side by side: in a row the label was squeezed into a
        // narrow column and the price wrapped over two lines.
        <Card
          elevation="none"
          style={{ backgroundColor: theme.colors.surfaceSunken, gap: theme.spacing.xs }}
        >
          <Text variant="caption" tone="muted">
            {t('emergency.estimatedPrice', {
              service: isArabic ? service.nameAr : service.nameEn,
            })}
          </Text>
          <Text variant="bodyStrong" numeric>
            {t('emergency.priceFixed', {
              // Emergency prices are always fixed centrally (§11).
              amount:
                service.basePrice === null
                  ? '—'
                  : formatSarDisplay(priceWithVat(service.basePrice)),
            })}
          </Text>
        </Card>
      ) : null}

      <Button
        testID="emergency-continue"
        label={t('common.continue')}
        onPress={() => {
          // Commit the implicit selection before leaving: the location screen
          // reads the draft, and an inherited choice that was never written
          // there submits an order against no vehicle at all.
          if (vehicleId === null && effectiveVehicleId !== null) selectVehicle(effectiveVehicleId);
          router.push('/emergency/location');
        }}
        disabled={!canContinue}
      />
    </Screen>
  );
}
