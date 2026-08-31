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
import { Button, Card, HabbaMark, Screen, Text, useTheme } from '@habba/ui';
import { MaintenanceAlertCard } from '@/components/home/MaintenanceAlertCard';
import { RecentOrderRow } from '@/components/home/RecentOrderRow';
import { repository } from '@/data/repository';
import { useIsAuthenticated, useIsGuest } from '@/state/session';

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

  const recentOrders = useQuery({
    queryKey: ['recent-orders'],
    queryFn: () => repository.listRecentOrders(1),
  });

  const primaryVehicleId = vehicles.data?.[0]?.id;

  // Alerts belong to the car the switcher has selected. Only the first vehicle
  // for now — a switcher that changes which car the home screen is about is
  // its own piece of work, and querying every vehicle's alerts to show one
  // card would be wasteful.
  const alerts = useQuery({
    queryKey: ['maintenance-alerts', primaryVehicleId],
    queryFn: () => repository.listMaintenanceAlerts(primaryVehicleId ?? ''),
    enabled: primaryVehicleId !== undefined,
  });
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
    router.push('/emergency/service');
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

      {(alerts.data ?? []).slice(0, 1).map((alert) => (
        <MaintenanceAlertCard
          key={alert.id}
          testID="home-maintenance-alert"
          alert={alert}
          onBook={() => router.push('/booking')}
        />
      ))}

      {/*
        Teal, not red, and deliberately so. §8 reserves red for a genuine
        emergency that is already under way — the design does not let it appear
        before the sixth screen of the flow. A red button sitting on the home
        screen at all times is exactly the "everything is urgent" failure the
        palette exists to prevent, and it would leave nothing louder to say
        when something actually is wrong.

        Given weight instead through size: the primary action is a full-width
        block roughly twice the height of the secondary one.
      */}
      <View style={{ gap: theme.spacing.md }}>
        <Card
          testID="home-emergency"
          elevation="md"
          onPress={handleEmergency}
          accessibilityLabel={t('home.emergencyCta')}
          style={{
            minHeight: 88,
            justifyContent: 'center',
            backgroundColor: theme.colors.primary,
            borderColor: theme.colors.primary,
            borderRadius: theme.radius.xl,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.base }}>
            {/* Design screen 01 sets the mark inside the emergency block —
                on dark petrol, so the cream colourway. */}
            <HabbaMark size={46} on="dark" />
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Text variant="heading" style={{ color: theme.colors.primaryText }}>
                {t('home.emergencyCta')}
              </Text>
              <Text variant="caption" style={{ color: theme.colors.primaryText, opacity: 0.85 }}>
                {t('home.emergencySubtitle')}
              </Text>
            </View>
          </View>
        </Card>

        <Button
          testID="home-booking"
          label={t('home.bookAppointment')}
          variant="secondary"
          onPress={() => router.push('/booking')}
        />

        {(recentOrders.data ?? []).map((order) => (
          <RecentOrderRow
            key={order.id}
            testID="home-recent-order"
            order={order}
            onPress={() => router.push({ pathname: '/tracking', params: { id: order.id } })}
          />
        ))}
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
    </Screen>
  );
}
