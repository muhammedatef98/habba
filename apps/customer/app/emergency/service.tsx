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
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/data/repository';
import { useEmergencyDraft } from '@/state/emergency-draft';
import { vehicleLabel } from '@/lib/vehicle-label';

export default function ServiceSelectionScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');

  const service = useEmergencyDraft((state) => state.service);
  const vehicleId = useEmergencyDraft((state) => state.vehicleId);
  const selectService = useEmergencyDraft((state) => state.selectService);
  const selectVehicle = useEmergencyDraft((state) => state.selectVehicle);

  const services = useQuery({
    queryKey: ['emergency-services'],
    queryFn: () => repository.listEmergencyServices(),
  });

  // Needed only to name the vehicle chips. Same query keys as the home screen,
  // so this is a cache hit rather than a second round trip.
  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const allModels = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => repository.listModels(''),
  });

  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => repository.listVehicles(),
  });

  const requiresVehicle = service?.requiresVehicle ?? false;
  const canContinue = service !== null && (!requiresVehicle || vehicleId !== null);

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('emergency.serviceHeadline')}</Text>
        <Text variant="body" tone="muted">
          {t('emergency.serviceSubhead')}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
        {services.data?.map((option) => {
          const isSelected = service?.id === option.id;
          return (
            <Card
              key={option.id}
              testID={`emergency-service-${option.id}`}
              elevation={isSelected ? 'md' : 'none'}
              onPress={() => selectService(option)}
              accessibilityLabel={option.nameAr}
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
              <View style={{ gap: theme.spacing.xs }}>
                <Text variant="heading">{option.nameAr}</Text>
                {option.descriptionAr !== null ? (
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {vehicles.data?.map((vehicle) => {
              const isSelected = vehicleId === vehicle.id;
              return (
                <Card
                  key={vehicle.id}
                  testID={`emergency-vehicle-${vehicle.id}`}
                  elevation={isSelected ? 'md' : 'none'}
                  onPress={() => selectVehicle(vehicle.id)}
                  style={{
                    borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                    borderWidth: isSelected ? 1.5 : 1,
                  }}
                >
                  <Text variant="body">
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
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text variant="caption" tone="muted">
              {t('emergency.estimatedPrice', { service: service.nameAr })}
            </Text>
            <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
              {t('emergency.priceFixed', { amount: service.basePrice })}
            </Text>
          </View>
        </Card>
      ) : null}

      <Button
        testID="emergency-continue"
        label={t('common.continue')}
        onPress={() => router.push('/emergency/location')}
        disabled={!canContinue}
      />
    </Screen>
  );
}
