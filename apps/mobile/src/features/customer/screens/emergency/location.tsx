/**
 * Screen 03 — confirm where the vehicle is, then send.
 *
 * The design fixes the pin at the centre of the screen and moves the map
 * underneath it, because dragging a small pin accurately with one thumb while
 * stressed is worse than moving the whole field. The free-text address stays
 * alongside the map rather than being replaced by it: a pin is exact but
 * useless over the phone, and "after exit 9 by 300m" is what actually gets a
 * technician to the right stretch of road.
 *
 * "Roadside" vs "in a car park" is not decoration: it changes what the
 * technician brings and whether a tow truck can physically reach the vehicle.
 */

import { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useFeatures } from '@/features/shared/hooks/use-platform';
import { locationProvider } from '@/features/shared/lib/location';
import {
  MAP_FALLBACK_LOCATION,
  movedFromFallback,
  type DeviceLocation,
} from '@/features/shared/lib/location-provider';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { priceWithVat } from '@/features/shared/lib/order-price';
import { registerThisDevice } from '@/features/shared/lib/push';
import { useEmergencyDraft, type PlaceKind } from '@/features/shared/state/emergency-draft';
import { LocationPicker } from '@/features/customer/components/map/LocationPicker';

export default function LocationConfirmScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const draft = useEmergencyDraft();
  const features = useFeatures();
  const [locationDenied, setLocationDenied] = useState(false);
  const [pinMoved, setPinMoved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * The order this screen already created, if sending it failed afterwards.
   * A retry sends that one rather than creating a second: two taps on a slow
   * roadside connection must not put two emergencies out.
   */
  const createdId = useRef<string | null>(null);

  // Located once rather than continuously: "location confirm" is a one-shot
  // fix. Live tracking follows the provider, not the customer.
  useQuery({
    queryKey: ['device-location'],
    queryFn: async () => {
      const result = await locationProvider.getCurrentLocation();
      if (result.ok) {
        draft.setLocation(result.location);
      } else {
        // No permission is a normal answer, not a dead end: the map opens on
        // a fallback the customer moves to their car.
        setLocationDenied(true);
        if (draft.location === null) draft.setLocation(MAP_FALLBACK_LOCATION);
      }
      return result;
    },
    staleTime: Infinity,
  });

  const handleSettled = (location: DeviceLocation) => {
    draft.setLocation(location);
    if (movedFromFallback(location)) setPinMoved(true);
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (draft.service === null) throw new Error('no_service');
      if (draft.location === null) throw new Error('no_location');
      if (draft.service.requiresVehicle && draft.vehicleId === null) {
        throw new Error('no_vehicle');
      }

      const orderId =
        createdId.current ??
        (await repository.createEmergencyOrder({
          serviceId: draft.service.id,
          lon: draft.location.lon,
          lat: draft.location.lat,
          ...(draft.vehicleId !== null ? { vehicleId: draft.vehicleId } : {}),
          ...(draft.addressAr.trim().length > 0 ? { addressAr: draft.addressAr.trim() } : {}),
          ...(draft.problem.trim().length > 0 ? { problem: draft.problem.trim() } : {}),
        }));
      createdId.current = orderId;

      // Created is not sent. This holds the payment and puts the request in
      // front of nearby technicians — until it succeeds, nobody can see it.
      await repository.submitOrder(orderId);
      return orderId;
    },
    onMutate: () => setError(undefined),
    onSuccess: (orderId) => {
      // The moment asking makes sense: they have just sent for help and want
      // to hear when someone accepts. Not awaited — the answer changes nothing
      // about the request, which is already out.
      void registerThisDevice({ prompt: true, locale: i18n.language });
      // The draft is finished the moment the server owns the order. Leaving it
      // populated would pre-fill the next emergency with this one's answers.
      draft.reset();
      // The clip step is an operators' switch (0081); off, straight to tracking.
      if (features.videoTriage) {
        router.replace({ pathname: '/emergency/triage', params: { id: orderId } });
      } else {
        router.replace({ pathname: '/tracking', params: { id: orderId } });
      }
    },
    onError: (mutationError: Error) => {
      // Closing the card form is a decision, not a failure: no message.
      if (mutationError.message === 'submitOrder/payment: cancelled') return;
      // Switched off while this screen was open (0081).
      if (mutationError.message.includes('switched off')) {
        setError(t('features.unavailableTitle'));
        return;
      }
      setError(
        mutationError.message === 'no_location'
          ? t('emergency.errors.noLocation')
          : mutationError.message === 'no_vehicle'
            ? t('emergency.vehicleRequired')
            : mutationError.message.startsWith('submitOrder/payment')
              ? t('emergency.errors.paymentFailed')
              : t('emergency.errors.createFailed'),
      );
    },
  });

  const held =
    draft.service === null || draft.service.basePrice === null
      ? null
      : priceWithVat(draft.service.basePrice);

  const places: readonly { readonly kind: PlaceKind; readonly label: string }[] = [
    { kind: 'roadside', label: t('emergency.placeRoadside') },
    { kind: 'parking', label: t('emergency.placeParking') },
  ];

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('emergency.locationTitle')}</Text>
        <Text variant="body" tone="muted">
          {locationDenied ? t('emergency.locationDenied') : t('emergency.locationHint')}
        </Text>
      </View>

      {draft.location !== null ? (
        <LocationPicker testID="emergency-map" initial={draft.location} onSettled={handleSettled} />
      ) : !locationDenied ? (
        <Text variant="caption" tone="muted">
          {t('emergency.locatingNow')}
        </Text>
      ) : null}

      <Field
        testID="emergency-address"
        label={t('emergency.addressLabel')}
        value={draft.addressAr}
        onChangeText={draft.setAddress}
        placeholder={t('emergency.addressPlaceholder')}
        multiline
      />

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          gap: theme.spacing.sm,
        }}
      >
        {places.map((place) => {
          const isSelected = draft.placeKind === place.kind;
          return (
            <Card
              selected={isSelected}
              key={place.kind}
              testID={`emergency-place-${place.kind}`}
              elevation="none"
              onPress={() => draft.setPlaceKind(place.kind)}
              style={{
                flex: 1,
                alignItems: 'center',
                backgroundColor: isSelected
                  ? theme.colors.primarySubtle
                  : theme.colors.surfaceSunken,
                borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                borderWidth: isSelected ? 1.5 : 1,
              }}
            >
              <Text variant="body" tone={isSelected ? 'primary' : 'muted'}>
                {place.label}
              </Text>
            </Card>
          );
        })}
      </View>

      <Field
        testID="emergency-problem"
        label={`${t('emergency.problemLabel')} — ${t('common.optional')}`}
        value={draft.problem}
        onChangeText={draft.setProblem}
        multiline
      />

      {/* The escrow promise (§1), said where the customer commits: what is
          held, and that nothing is taken until they say the job is done. */}
      {held !== null ? (
        <Text testID="emergency-payment-hold" variant="caption" tone="muted">
          {t('emergency.paymentHold', { amount: formatSarDisplay(held) })}
        </Text>
      ) : null}

      {/* A disabled button with no reason next to it reads as broken. The
          reason is at the top of the screen, but that has scrolled away by
          the time a thumb reaches the button. */}
      {locationDenied && !pinMoved ? (
        <Text testID="emergency-move-pin" variant="caption" tone="warning">
          {t('emergency.movePinToSend')}
        </Text>
      ) : null}

      {error !== undefined ? (
        <Text testID="emergency-error" variant="caption" tone="emergency">
          {error}
        </Text>
      ) : null}

      {/*
        Teal, not red. The design forbids red before the sixth screen: red here
        would read as "something has gone wrong" at the exact moment the app is
        telling the customer help is on the way.
      */}
      <Button
        testID="emergency-submit"
        label={t('emergency.confirmAndSubmit')}
        onPress={() => submit.mutate()}
        loading={submit.isPending}
        disabled={
          draft.location === null || draft.service === null || (locationDenied && !pinMoved)
        }
      />
    </Screen>
  );
}
