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
import { Button, Card, ErrorState, Icon, Screen, Text, useTheme } from '@habba/ui';
import { ActiveOrderCard } from '@/components/home/ActiveOrderCard';
import { RecentOrderRow } from '@/components/home/RecentOrderRow';
import { SectionHeader } from '@/components/home/SectionHeader';
import { repository } from '@/data/repository';
import { useIsAuthenticated } from '@/state/session';

const HISTORY_LIMIT = 50;

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();

  const orders = useQuery({
    queryKey: ['orders', 'all'],
    queryFn: () => repository.listRecentOrders(HISTORY_LIMIT),
  });

  const refetch = orders.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (!isAuthenticated) return <Redirect href="/" />;

  const rows = orders.data ?? [];
  const live = rows.filter((order) => isActiveJob(order.status));
  const past = rows.filter((order) => !isActiveJob(order.status));

  const openOrder = (id: string) => router.push({ pathname: '/tracking', params: { id } });

  if (orders.isPending) {
    return (
      <Screen>
        <Text variant="title">{t('nav.orders')}</Text>
        <Text variant="body" tone="muted">
          {t('common.loading')}
        </Text>
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

  if (rows.length === 0) {
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
      </ScrollView>
    </Screen>
  );
}
