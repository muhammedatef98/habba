/**
 * Order history.
 *
 * Split into what is happening and what already happened, because those are
 * two different questions and a single reverse-chronological list answers
 * neither well: a live job three rows down looks exactly like a job from
 * March. Live work is pinned to the top under its own heading and keeps the
 * pulsing card the home screen uses, so "my order" looks the same wherever the
 * customer meets it.
 *
 * Refetches on focus for the same reason home does — a tab screen is never
 * unmounted, and an order's status changes on the server while the customer is
 * looking at another tab.
 */

import { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isActiveJob } from '@habba/core';
import { Button, Card, ErrorState, Icon, Screen, SkeletonCard, Text, useTheme } from '@habba/ui';
import { ActiveOrderCard } from '@/features/customer/components/home/ActiveOrderCard';
import { RecentOrderRow } from '@/features/customer/components/home/RecentOrderRow';
import { SectionHeader } from '@/features/customer/components/home/SectionHeader';
import { InspectionRow } from '@/features/customer/components/orders/InspectionRow';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated } from '@/features/shared/state/session';

const HISTORY_LIMIT = 50;

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();

  const orders = useQuery({
    queryKey: ['orders', 'all'],
    queryFn: () => repository.listRecentOrders(HISTORY_LIMIT),
  });

  /**
   * فحوصاتي — the reports, which are not orders.
   *
   * A pre-purchase inspection is the one order that runs against a car nobody
   * owns, so its result does not live on a vehicle and cannot be found through
   * the logbook. Until this section existed, `listMyInspections` was called by
   * nothing and `/inspection-report` was a screen with no link into it: a
   * buyer paid for an inspection and had no way to read it.
   *
   * It lives here rather than behind its own tab because a buyer opens it once
   * or twice in their life — and "what did I order and what came of it" is the
   * question this tab already answers.
   */
  const inspections = useQuery({
    queryKey: ['inspections'],
    queryFn: () => repository.listMyInspections(),
  });

  const refetch = orders.refetch;
  const refetchInspections = inspections.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
      void refetchInspections();
    }, [refetch, refetchInspections]),
  );

  if (!isAuthenticated) return <Redirect href="/" />;

  const rows = orders.data ?? [];
  const live = rows.filter((order) => isActiveJob(order.status));
  const past = rows.filter((order) => !isActiveJob(order.status));
  const reports = inspections.data ?? [];

  const openOrder = (id: string) => router.push({ pathname: '/tracking', params: { id } });

  if (orders.isPending) {
    return (
      <Screen>
        <Text variant="title">{t('nav.orders')}</Text>
        {/* The shape that is about to arrive, so the screen does not jump from
            empty to full — and one spoken announcement rather than six silent
            boxes for a screen reader. */}
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('common.loading')}
          style={{ gap: theme.spacing.md }}
        >
          <SkeletonCard testID="orders-skeleton" />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </Screen>
    );
  }

  // A failed fetch must not render as "you have never ordered anything". The
  // empty state below is an invitation; showing it to someone whose request is
  // in flight right now would be a lie about their own history.
  if (orders.isError) {
    return (
      <Screen>
        <Text variant="title">{t('nav.orders')}</Text>
        <ErrorState
          testID="orders-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={orders.isFetching}
          onRetry={() => void orders.refetch()}
        />
      </Screen>
    );
  }

  // Both empty, not just the orders. An inspection always has an order behind
  // it, so this is belt and braces — but `listRecentOrders` is capped at 50 and
  // an invitation to book a first service, shown above a list of the customer's
  // own inspection reports, would be the screen contradicting itself.
  if (rows.length === 0 && reports.length === 0) {
    return (
      <Screen>
        <Text variant="title">{t('nav.orders')}</Text>

        {/* An empty history is not a failure state, so it does not get an
            error's treatment — it gets the two things the customer can do
            from here, which is the whole app in two buttons. */}
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: theme.radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surfaceSunken,
              }}
            >
              <Icon name="calendar" size={28} color={theme.colors.textSubtle} />
            </View>
            <Text variant="heading" align="center">
              {t('home.noRecent')}
            </Text>
            <Text variant="bodySmall" tone="muted" align="center">
              {t('orders.emptyBody')}
            </Text>
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Button
              testID="orders-empty-emergency"
              label={t('home.emergencyCta')}
              onPress={() => router.push('/emergency/service')}
            />
            <Button
              testID="orders-empty-booking"
              label={t('home.bookAppointment')}
              variant="secondary"
              onPress={() => router.push('/booking')}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable={false} style={{ gap: theme.spacing.base }}>
      <Text variant="title">{t('nav.orders')}</Text>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.spacing.xl, paddingBottom: theme.spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={orders.isFetching}
            onRefresh={() => void orders.refetch()}
            tintColor={theme.colors.primary}
          />
        }
      >
        {live.length > 0 ? (
          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader title={t('orders.liveTitle')} />
            {live.map((order) => (
              <ActiveOrderCard
                key={order.id}
                testID="orders-live"
                order={order}
                onPress={() => openOrder(order.id)}
              />
            ))}
          </View>
        ) : null}

        {past.length > 0 ? (
          <View style={{ gap: theme.spacing.xs }}>
            <SectionHeader title={t('orders.pastTitle')} />
            <Card elevation="none" style={{ paddingVertical: theme.spacing.xs }}>
              {past.map((order, index) => (
                <View
                  key={order.id}
                  style={
                    index === 0
                      ? undefined
                      : { borderTopWidth: 1, borderTopColor: theme.colors.border }
                  }
                >
                  <RecentOrderRow
                    testID="orders-past"
                    order={order}
                    onPress={() => openOrder(order.id)}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {/* فحوصاتي. Below the order history, because a report is something the
            customer comes back for rather than something they are waiting on —
            and because the one that matters most, a car they have just bought,
            is the one they will have opened from the notification anyway. */}
        {reports.length > 0 ? (
          <View style={{ gap: theme.spacing.xs }}>
            <SectionHeader title={t('inspections.sectionTitle')} />
            <Card elevation="none" style={{ paddingVertical: theme.spacing.xs }}>
              {reports.map((inspection, index) => (
                <View
                  key={inspection.id}
                  style={
                    index === 0
                      ? undefined
                      : { borderTopWidth: 1, borderTopColor: theme.colors.border }
                  }
                >
                  <InspectionRow
                    testID="orders-inspection"
                    inspection={inspection}
                    onPress={() =>
                      router.push({
                        pathname: '/inspection-report',
                        params: { id: inspection.id },
                      })
                    }
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
