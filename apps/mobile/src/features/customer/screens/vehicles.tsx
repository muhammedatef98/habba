/**
 * Vehicle list — the home screen.
 *
 * §9.1 Home: vehicle switcher at top, two primary actions (طلب طارئ one tap /
 * حجز موعد). طلب طارئ jumps straight into the emergency flow rather than a
 * menu — that is the "one tap" the spec asks for. حجز موعد is a real route
 * today, but Phase 4 (slots, workshops) is not built yet, so it explains that
 * honestly instead of presenting a dead or fake button.
 */

import { View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated, useIsGuest } from '@/features/shared/state/session';

export default function VehiclesScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const isGuest = useIsGuest();
  const isArabic = i18n.language === 'ar';

  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => repository.listVehicles(),
  });

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const allModels = useQuery({
    queryKey: ['models', 'all'],
    queryFn: async () => {
      const makeList = await repository.listMakes();
      const lists = await Promise.all(makeList.map((make) => repository.listModels(make.id)));
      return lists.flat();
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const describe = (makeId: string, modelId: string) => {
    const make = makes.data?.find((m) => m.id === makeId);
    const model = allModels.data?.find((m) => m.id === modelId);
    const makeName = isArabic ? make?.nameAr : make?.nameEn;
    const modelName = isArabic ? model?.nameAr : model?.nameEn;
    return [makeName, modelName].filter(Boolean).join(' ');
  };

  const hasVehicles = (vehicles.data?.length ?? 0) > 0;

  function handleEmergency() {
    if (!hasVehicles) {
      router.push('/add-vehicle');
      return;
    }
    router.push('/emergency');
  }

  return (
    <Screen scrollable>
      <Text variant="title">{t('vehicle.myVehicles')}</Text>

      {/* Persistent but not modal: a guest is never blocked, only reminded.
          §11 — the logbook is not gated, so this asks rather than demands. */}
      {isGuest ? (
        <Card
          testID="guest-banner"
          elevation="none"
          style={{ backgroundColor: theme.colors.accentSubtle }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong" style={{ color: theme.colors.accentText }}>
              {t('auth.guestBannerTitle')}
            </Text>
            <Text variant="caption" style={{ color: theme.colors.accentText }}>
              {t('auth.guestBannerBody')}
            </Text>
            <Button
              testID="guest-save-account"
              label={t('auth.guestBannerAction')}
              variant="accent"
              size="medium"
              onPress={() => router.push('/save-account')}
            />
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            testID="home-emergency"
            label={t('home.emergencyAction')}
            variant="emergency"
            onPress={handleEmergency}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="home-booking"
            label={t('home.bookingAction')}
            variant="secondary"
            onPress={() => router.push('/booking')}
          />
        </View>
      </View>

      {vehicles.data?.length === 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{t('logbook.emptyTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('logbook.emptyBody')}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        {vehicles.data?.map((vehicle) => (
          <Card
            key={vehicle.id}
            testID={`vehicle-${vehicle.id}`}
            onPress={() => router.push({ pathname: '/logbook', params: { id: vehicle.id } })}
            accessibilityLabel={describe(vehicle.makeId, vehicle.modelId)}
          >
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="heading">
                {vehicle.nickname ?? describe(vehicle.makeId, vehicle.modelId)}
              </Text>
              <Text variant="caption" tone="muted">
                {describe(vehicle.makeId, vehicle.modelId)} · {vehicle.year}
              </Text>
              {vehicle.plateNormalised !== null ? (
                <Text variant="caption" tone="subtle">
                  {vehicle.plateNormalised}
                </Text>
              ) : null}
            </View>
          </Card>
        ))}
      </View>

      <Button
        testID="add-vehicle"
        label={vehicles.data?.length === 0 ? t('vehicle.addTitle') : t('vehicle.addAnother')}
        onPress={() => router.push('/add-vehicle')}
        variant={vehicles.data?.length === 0 ? 'primary' : 'secondary'}
      />

      {/* Where «اشتغل معنا كفنّي» and the mode switcher live (§9.0). */}
      <Button
        testID="open-profile"
        label={t('profile.title')}
        variant="ghost"
        onPress={() => router.push('/profile')}
      />
    </Screen>
  );
}
