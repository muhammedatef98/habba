/**
 * Emergency request — §9.1: service → location confirm → submit → tracking.
 *
 * The 20-second video triage from §9.1 is not built here (camera capture is a
 * separate, still-open piece of work — see the provider app's evidence
 * screen for the same gap on the other side). Everything else in the flow is
 * real: the price is read from the catalogue and never entered by the
 * customer, matching §11's "fix emergency prices centrally."
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { locationProvider } from '@/features/shared/lib/location';
import { useIsAuthenticated } from '@/features/shared/state/session';
import type { DeviceLocation } from '@/features/shared/lib/location-provider';
import type { Service } from '@/features/shared/data/types';

export default function EmergencyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState('');
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const services = useQuery({
    queryKey: ['emergency-services'],
    queryFn: () => repository.listEmergencyServices(),
  });

  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => repository.listVehicles(),
  });

  // Located once, on first render, rather than continuously — a one-shot fix
  // is what "location confirm" in §9.1 asks for; live tracking is the
  // provider's location, not the customer's.
  useQuery({
    queryKey: ['device-location'],
    queryFn: async () => {
      const result = await locationProvider.getCurrentLocation();
      if (result.ok) {
        setLocation(result.location);
      } else {
        setLocationDenied(true);
      }
      return result;
    },
    staleTime: Infinity,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (selectedService === null) throw new Error('no_service');
      if (location === null) throw new Error('no_location');
      if (selectedService.requiresVehicle && selectedVehicleId === null) {
        throw new Error('no_vehicle');
      }

      return repository.createEmergencyOrder({
        serviceId: selectedService.id,
        lon: location.lon,
        lat: location.lat,
        vehicleId: selectedVehicleId ?? undefined,
        addressAr: address.trim().length > 0 ? address.trim() : undefined,
        problem: problem.trim().length > 0 ? problem.trim() : undefined,
      });
    },
    onSuccess: (orderId) => {
      router.replace({ pathname: '/tracking', params: { id: orderId } });
    },
    onError: (mutationError: Error) => {
      setError(
        mutationError.message === 'no_location'
          ? t('emergency.errors.noLocation')
          : mutationError.message === 'no_vehicle'
            ? t('emergency.vehicleRequired')
            : t('emergency.errors.createFailed'),
      );
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const requiresVehicle = selectedService?.requiresVehicle ?? false;
  const canSubmit =
    selectedService !== null &&
    location !== null &&
    (!requiresVehicle || selectedVehicleId !== null);

  return (
    <Screen scrollable>
      <Text variant="title">{t('emergency.title')}</Text>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {t('emergency.serviceTitle')}
        </Text>

        <View style={{ gap: theme.spacing.sm }}>
          {services.data?.map((service) => {
            const isSelected = selectedService?.id === service.id;
            return (
              <Card
                key={service.id}
                testID={`emergency-service-${service.id}`}
                elevation={isSelected ? 'md' : 'none'}
                onPress={() => {
                  setSelectedService(service);
                  setError(undefined);
                }}
                style={{
                  borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                  borderWidth: isSelected ? 2 : 1,
                }}
              >
                <View style={{ gap: theme.spacing.xs }}>
                  <Text variant="bodyStrong">{service.nameAr}</Text>
                  <Text variant="caption" tone="muted">
                    {t('emergency.priceFixed', { amount: service.basePrice })}
                  </Text>
                </View>
              </Card>
            );
          })}
        </View>
      </View>

      {requiresVehicle ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('vehicle.myVehicles')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {vehicles.data?.map((vehicle) => {
              const isSelected = selectedVehicleId === vehicle.id;
              return (
                <Card
                  key={vehicle.id}
                  testID={`emergency-vehicle-${vehicle.id}`}
                  elevation={isSelected ? 'md' : 'none'}
                  onPress={() => setSelectedVehicleId(vehicle.id)}
                  style={{
                    borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                    borderWidth: isSelected ? 2 : 1,
                  }}
                >
                  <Text variant="body">
                    {vehicle.nickname ?? vehicle.plateNormalised ?? vehicle.id}
                  </Text>
                </Card>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" tone="muted">
          {t('emergency.locationTitle')}
        </Text>
        <Text variant="caption" tone="subtle">
          {locationDenied ? t('emergency.locationDenied') : t('emergency.locationHint')}
        </Text>

        {location === null && !locationDenied ? (
          <Text variant="caption" tone="muted">
            {t('emergency.locatingNow')}
          </Text>
        ) : null}

        <Field
          testID="emergency-address"
          label={t('emergency.addressLabel')}
          value={address}
          onChangeText={setAddress}
          placeholder={t('emergency.addressPlaceholder')}
          multiline
        />
      </View>

      <Field
        testID="emergency-problem"
        label={`${t('emergency.problemLabel')} — ${t('common.optional')}`}
        value={problem}
        onChangeText={setProblem}
        multiline
      />

      {error !== undefined ? (
        <Text variant="caption" style={{ color: theme.colors.emergency }}>
          {error}
        </Text>
      ) : null}

      <Button
        testID="emergency-submit"
        label={t('emergency.submit')}
        variant="emergency"
        onPress={() => submit.mutate()}
        loading={submit.isPending}
        disabled={!canSubmit}
      />
    </Screen>
  );
}
