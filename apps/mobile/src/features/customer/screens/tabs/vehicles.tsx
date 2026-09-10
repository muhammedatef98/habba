/**
 * Home.
 *
 * §9.1 asks for a vehicle switcher, two primary actions, and predictive alerts.
 * It got all three before this rewrite — as eight blocks of near-identical
 * visual weight separated by one uniform gap, which meant the screen had the
 * right contents and no hierarchy at all. Three things were actually wrong:
 *
 *  1. A live emergency appeared as a hairline row *below* the button that
 *     starts a new one. Reopening the app mid-job offered to start a second
 *     emergency before it offered to show you the first.
 *  2. The loudest object on the screen was the guest account-upsell — a filled
 *     amber block above a flat teal one. On an emergency app.
 *  3. Every car was drawn twice: once as a pill at the top, once as a card in a
 *     list below, neither with enough weight to be the subject of anything.
 *
 * The order below is the fix, and it is an order of urgency rather than of
 * feature importance: what is happening now, what you might need to start,
 * what your car is warning you about, what your car *is*, and only then the
 * account nudge and the history.
 *
 * Rhythm is explicit here. `Screen`'s uniform gap is switched off and each
 * section carries its own top margin, so grouped things (hero + quick
 * services) sit close and unrelated things sit far apart — §8's "intentional
 * rhythm in spacing, not uniform padding everywhere".
 */

import { useCallback } from 'react';
import { View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isActiveJob } from '@habba/core';
import { Button, Card, ErrorState, Screen, Text, useTheme } from '@habba/ui';
import { ActiveOrderCard } from '@/features/customer/components/home/ActiveOrderCard';
import { EmergencyHero } from '@/features/customer/components/home/EmergencyHero';
import { HomeHeader } from '@/features/customer/components/home/HomeHeader';
import { MaintenanceAlertCard } from '@/features/customer/components/home/MaintenanceAlertCard';
import { QuickServices } from '@/features/customer/components/home/QuickServices';
import { RecentOrderRow } from '@/features/customer/components/home/RecentOrderRow';
import { SectionHeader } from '@/features/customer/components/home/SectionHeader';
import { VehicleHeroCard } from '@/features/customer/components/home/VehicleHeroCard';
import { repository } from '@/features/shared/data/repository';
import { formatShortDate } from '@/features/shared/lib/format-number';
import { summariseLogbook } from '@/features/shared/lib/logbook-summary';
import { useEmergencyDraft } from '@/features/shared/state/emergency-draft';
import { useIsAuthenticated, useIsGuest, useSession } from '@/features/shared/state/session';
import type { Service } from '@/features/shared/data/types';

/** Enough to find a live job and still have a short tail of history under it. */
const RECENT_ORDER_LOOKBACK = 5;
const RECENT_ORDERS_SHOWN = 3;

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const isGuest = useIsGuest();
  const isArabic = i18n.language.startsWith('ar');

  const fullName = useSession((state) => state.fullName);
  const selectedVehicleId = useSession((state) => state.selectedVehicleId);
  const selectVehicle = useSession((state) => state.selectVehicle);

  const selectDraftService = useEmergencyDraft((state) => state.selectService);
  const selectDraftVehicle = useEmergencyDraft((state) => state.selectVehicle);

  const queryClient = useQueryClient();

  /**
   * Refetch the live data every time this tab comes back into view.
   *
   * A tab screen is never unmounted, so without this the home screen keeps
   * whatever it fetched on first launch: coming back from a just-created
   * emergency showed no live job at all, which defeats the entire point of the
   * card at the top. Invalidating at the mutation would not be enough either —
   * an order's status changes on the *server* as the provider accepts, drives
   * and arrives, and none of that passes through this app.
   *
   * Scoped to the two queries that actually go stale. The catalogue, the makes
   * and the models do not change while someone is looking at their phone.
   */
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['recent-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    }, [queryClient]),
  );

  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => repository.listVehicles(),
  });

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });

  const allModels = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => repository.listAllModels(),
  });

  const recentOrders = useQuery({
    queryKey: ['recent-orders'],
    queryFn: () => repository.listRecentOrders(RECENT_ORDER_LOOKBACK),
  });

  const services = useQuery({
    queryKey: ['emergency-services'],
    queryFn: () => repository.listEmergencyServices(),
  });

  // The car the switcher has selected, falling back to the first. The fallback
  // matters: a household with two cars still has a most-likely one, and making
  // someone choose before the app shows them anything is a toll on every launch.
  const selectedVehicle =
    vehicles.data?.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles.data?.[0];
  const primaryVehicleId = selectedVehicle?.id;

  // Alerts and logbook figures belong to the *selected* car, not a fixed first
  // entry — switching cars has to change them or the switcher is decoration.
  const alerts = useQuery({
    queryKey: ['maintenance-alerts', primaryVehicleId],
    queryFn: () => repository.listMaintenanceAlerts(primaryVehicleId ?? ''),
    enabled: primaryVehicleId !== undefined,
  });

  const timeline = useQuery({
    queryKey: ['timeline', primaryVehicleId],
    queryFn: () => repository.listTimeline(primaryVehicleId ?? ''),
    enabled: primaryVehicleId !== undefined,
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const hasVehicles = (vehicles.data?.length ?? 0) > 0;

  // One live job at most is shown. If somehow there are several, the newest is
  // the one being lived through right now.
  const activeOrder = recentOrders.data?.find((order) => isActiveJob(order.status));
  const pastOrders = (recentOrders.data ?? [])
    .filter((order) => order.id !== activeOrder?.id)
    .slice(0, RECENT_ORDERS_SHOWN);

  const logbook = timeline.data === undefined ? undefined : summariseLogbook(timeline.data);
  const lastServiceLabel =
    logbook?.lastServiceAt != null
      ? formatShortDate(logbook.lastServiceAt, i18n.language)
      : undefined;

  function openEmergency() {
    if (!hasVehicles) {
      router.push('/add-vehicle');
      return;
    }
    router.push('/emergency/service');
  }

  /**
   * A quick tile answers screen 02 on the way in, so the flow opens at the
   * location step. The vehicle has to be pushed into the draft as well:
   * `location.tsx` reads `draft.vehicleId` directly and refuses to submit
   * without it when the service needs one — skipping the service screen skips
   * where that was being set.
   */
  function startQuickService(service: Service) {
    if (service.requiresVehicle && primaryVehicleId === undefined) {
      router.push('/add-vehicle');
      return;
    }

    selectDraftService(service);
    if (primaryVehicleId !== undefined) selectDraftVehicle(primaryVehicleId);
    router.push('/emergency/location');
  }

  return (
    <Screen scrollable style={{ gap: 0 }}>
      <HomeHeader
        testID="home-header"
        {...(!isGuest && fullName !== null ? { name: fullName } : {})}
      />

      {activeOrder !== undefined ? (
        <View style={{ marginTop: theme.spacing.lg }}>
          <ActiveOrderCard
            testID="home-active-order"
            order={activeOrder}
            onPress={() => router.push({ pathname: '/tracking', params: { id: activeOrder.id } })}
          />
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
        <EmergencyHero testID="home-emergency" onPress={openEmergency} />

        <QuickServices
          testID="home-quick-services"
          services={services.data ?? []}
          isArabic={isArabic}
          onSelect={startQuickService}
        />

        {/* §9.1's second primary action, with its own breathing room: the
            hero and the tiles are one group (start an emergency now), and
            booking ahead is a different intent that should not read as a
            fifth tile. */}
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button
            testID="home-booking"
            label={t('home.bookAppointment')}
            variant="secondary"
            onPress={() => router.push('/booking')}
          />
        </View>
      </View>

      {(alerts.data ?? []).slice(0, 1).map((alert) => (
        <View key={alert.id} style={{ marginTop: theme.spacing.xl }}>
          <MaintenanceAlertCard
            testID="home-maintenance-alert"
            alert={alert}
            onBook={() => router.push('/booking')}
          />
        </View>
      ))}

      <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}>
        <SectionHeader
          title={hasVehicles ? t('home.vehicleTitle') : t('vehicle.myVehicles')}
          {...(hasVehicles
            ? {
                actionLabel: t('vehicle.addAnother'),
                onAction: () => router.push('/add-vehicle'),
              }
            : {})}
        />

        {/* A failed fetch renders as "your logbook starts here" otherwise, and
            the customer is invited to add a car they already own — into a
            product whose whole promise is that it remembers their cars. */}
        {vehicles.isError ? (
          <ErrorState
            testID="home-vehicles-error"
            message={t('errors.offline')}
            retryLabel={t('common.retry')}
            retrying={vehicles.isFetching}
            onRetry={() => void vehicles.refetch()}
          />
        ) : selectedVehicle !== undefined ? (
          <VehicleHeroCard
            testID="home-vehicle"
            vehicles={vehicles.data ?? []}
            selected={selectedVehicle}
            makes={makes.data}
            models={allModels.data}
            {...(logbook !== undefined ? { recordCount: logbook.recordCount } : {})}
            {...(lastServiceLabel !== undefined ? { lastServiceLabel } : {})}
            onSelect={selectVehicle}
            onOpenLogbook={() =>
              router.push({ pathname: '/logbook', params: { id: selectedVehicle.id } })
            }
          />
        ) : (
          <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
            <View style={{ gap: theme.spacing.md }}>
              <Text variant="heading">{t('logbook.emptyTitle')}</Text>
              <Text variant="body" tone="muted">
                {t('logbook.emptyBody')}
              </Text>
              <Button
                testID="add-vehicle"
                label={t('vehicle.addTitle')}
                onPress={() => router.push('/add-vehicle')}
              />
            </View>
          </Card>
        )}
      </View>

      {/* Demoted, on purpose. §11 says the logbook is never gated and the
          prompt should ask rather than demand — a filled amber block above the
          emergency CTA was demanding. It keeps its own colour and its place on
          every launch; it just no longer outranks the reason the app exists. */}
      {isGuest ? (
        <View style={{ marginTop: theme.spacing.xl }}>
          <Card
            testID="guest-banner"
            elevation="none"
            onPress={() => router.push('/save-account')}
            accessibilityLabel={t('auth.guestBannerAction')}
            style={{
              backgroundColor: theme.colors.accentSubtle,
              borderColor: theme.colors.accent,
              borderWidth: 1,
              gap: theme.spacing.xs,
            }}
          >
            {/* `accentText` is the label colour for a *filled* amber button —
                near-black in light, and dark petrol in dark mode. Painted on
                `accentSubtle` it measured 1.15:1: dark green on dark brown,
                which is why this banner read as an unreadable green block.
                `accentFg` is the amber-as-text token and clears 4.5:1 on this
                surface in both schemes (tokens.ts). */}
            <Text variant="bodyStrong" tone="accent">
              {t('auth.guestBannerTitle')}
            </Text>
            <Text variant="caption" tone="accent">
              {t('auth.guestBannerBody')}
            </Text>
            <Text variant="label" tone="accent" style={{ marginTop: theme.spacing.xs }}>
              {t('auth.guestBannerAction')}
            </Text>
          </Card>
        </View>
      ) : null}

      {pastOrders.length > 0 ? (
        <View style={{ marginTop: theme.spacing.xl }}>
          <SectionHeader
            title={t('home.recentTitle')}
            actionLabel={t('home.quickAll')}
            onAction={() => router.push('/orders')}
          />
          <View style={{ marginTop: theme.spacing.xs }}>
            {pastOrders.map((order, index) => (
              <View
                key={order.id}
                style={
                  index === 0
                    ? undefined
                    : { borderTopWidth: 1, borderTopColor: theme.colors.border }
                }
              >
                <RecentOrderRow
                  testID="home-recent-order"
                  order={order}
                  onPress={() => router.push({ pathname: '/tracking', params: { id: order.id } })}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
