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
 * your car and what it needs next, what you can book for it, and only then
 * the history and the account nudge.
 *
 * Revised again from screenshots: the car — the logbook, the product's reason
 * to exist between emergencies — sat at the bottom under a separate orange
 * alert about it, and booking was one card describing services instead of
 * showing them. The alert now lives in the car's card, and the services are
 * on the screen with their prices, one tap from a booking already filled in.
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
import { Button, Card, ErrorState, Screen, Text, useTheme, FadeIn, staggerDelay } from '@habba/ui';
import { ActiveOrderCard } from '@/features/customer/components/home/ActiveOrderCard';
import { BookableServices } from '@/features/customer/components/home/BookableServices';
import { EmergencyHero } from '@/features/customer/components/home/EmergencyHero';
import { HomeHeader } from '@/features/customer/components/home/HomeHeader';
import { QuickServices } from '@/features/customer/components/home/QuickServices';
import { RecentOrderRow } from '@/features/customer/components/home/RecentOrderRow';
import { SectionHeader } from '@/features/customer/components/home/SectionHeader';
import { VehicleHeroCard } from '@/features/customer/components/home/VehicleHeroCard';
import { repository } from '@/features/shared/data/repository';
import { useLiveRefresh } from '@/features/shared/lib/live';
import { formatCount, formatShortDate } from '@/features/shared/lib/format-number';
import { summariseLogbook } from '@/features/shared/lib/logbook-summary';
import { useBookingDraft } from '@/features/shared/state/booking-draft';
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
  const liveUserId = useSession((state) => state.userId);
  const selectedVehicleId = useSession((state) => state.selectedVehicleId);
  const selectVehicle = useSession((state) => state.selectVehicle);

  const selectDraftService = useEmergencyDraft((state) => state.selectService);
  const bookingDraft = useBookingDraft();
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
      void queryClient.invalidateQueries({ queryKey: ['transfer', 'incoming'] });
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

  // Same key as the booking screen's, so opening it after a tap here is a
  // cache hit.
  const bookable = useQuery({
    queryKey: ['bookable-services'],
    queryFn: () => repository.listBookableServices(),
  });

  /**
   * A car someone is handing to this account (§1.3).
   *
   * This banner is the ONLY way a recipient learns a transfer exists. The
   * server tells nobody: there is no SMS, no push and no email — the code is
   * spoken at handover — so a buyer who is never shown this never finds the
   * flow, which is exactly how the acquisition loop stayed closed through
   * three migrations that had already reopened it in the database.
   */
  const incomingTransfer = useQuery({
    queryKey: ['transfer', 'incoming'],
    queryFn: () => repository.getIncomingTransfer(),
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

  // An order that moves on while الرئيسية is open shows it here too — the tab
  // is never unmounted, so focus alone did not catch it.
  useLiveRefresh(
    [{ table: 'orders', filter: `customer_id=eq.${liveUserId ?? ''}` }],
    [['recent-orders'], ['orders']],
    liveUserId !== null,
  );

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

  /**
   * Opens booking with the service already chosen: the card the customer
   * tapped was the answer to the first question on that screen. A draft left
   * from an earlier, abandoned booking is cleared first so its provider and
   * slot do not ride along with a different service.
   */
  function bookService(service: Service | undefined) {
    bookingDraft.reset();
    if (service !== undefined) bookingDraft.selectService(service);
    router.push('/booking');
  }

  const alert = (alerts.data ?? [])[0];

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
        onAccount={() => router.push('/account')}
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

      <FadeIn delay={0}>
        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.sm }}>
          <EmergencyHero testID="home-emergency" onPress={openEmergency} />

          <QuickServices
            testID="home-quick-services"
            services={services.data ?? []}
            isArabic={isArabic}
            onSelect={startQuickService}
          />
        </View>
      </FadeIn>

      {/* Above the car and below the live job: someone is standing next to
          this person waiting to hand over a car, which outranks a maintenance
          reminder and does not outrank a technician already on the way. */}
      {incomingTransfer.data !== null && incomingTransfer.data !== undefined ? (
        <View style={{ marginTop: theme.spacing.xl }}>
          <Card
            testID="home-incoming-transfer"
            elevation="sm"
            onPress={() => router.push('/accept-transfer')}
            accessibilityLabel={t('transfer.incomingTitle')}
            style={{ gap: theme.spacing.xs, borderColor: theme.colors.primary, borderWidth: 1 }}
          >
            <Text variant="bodyStrong" tone="primary">
              {t('transfer.incomingTitle')}
            </Text>
            <Text variant="bodySmall" tone="muted">
              {t('transfer.incomingBannerBody', {
                vehicle: isArabic
                  ? `${incomingTransfer.data.makeAr} ${incomingTransfer.data.modelAr}`
                  : `${incomingTransfer.data.makeEn} ${incomingTransfer.data.modelEn}`,
              })}
            </Text>
          </Card>
        </View>
      ) : null}

      <FadeIn delay={staggerDelay(1)}>
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
              {...(alert !== undefined
                ? {
                    alert: {
                      message: isArabic ? alert.messageAr : alert.messageEn,
                      ...(alert.estimatedKm !== null
                        ? {
                            detail: t('home.lastReading', {
                              km: formatCount(alert.estimatedKm, i18n.language),
                            }),
                          }
                        : {}),
                    },
                    onAlertPress: () =>
                      bookService(bookable.data?.find((service) => service.id === alert.serviceId)),
                  }
                : {})}
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
      </FadeIn>

      {(bookable.data?.length ?? 0) > 0 ? (
        <FadeIn delay={staggerDelay(2)}>
          <View
            testID="home-booking"
            style={{ marginTop: theme.spacing.xl, gap: theme.spacing.md }}
          >
            <SectionHeader
              title={t('home.bookTitle')}
              actionLabel={t('home.quickAll')}
              onAction={() => bookService(undefined)}
            />
            <BookableServices
              testID="home-bookable"
              services={bookable.data ?? []}
              onSelect={bookService}
            />
          </View>
        </FadeIn>
      ) : null}

      {pastOrders.length > 0 ? (
        <FadeIn delay={staggerDelay(3)}>
          <View style={{ marginTop: theme.spacing.xl }}>
            <SectionHeader
              title={t('home.recentTitle')}
              actionLabel={t('home.quickAll')}
              onAction={() => router.push('/orders')}
            />
            {/* In a card, as on the orders tab: the same rows on bare page
              background here read as a different, lesser list. */}
            <Card
              elevation="none"
              style={{ marginTop: theme.spacing.md, paddingVertical: theme.spacing.xs }}
            >
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
            </Card>
          </View>
        </FadeIn>
      ) : null}

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
    </Screen>
  );
}
