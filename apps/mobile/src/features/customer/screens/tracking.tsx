/**
 * Live tracking — §8: "the emotional core of the product. Invest in it."
 *
 * §9.1: status timeline + ETA + provider card + call/chat. There is no real
 * map or live provider position here yet — react-native-maps and the
 * customer-facing read of provider_locations are both open work — but the
 * status progression, the quote-approval handoff, the completion
 * confirmation that triggers payment capture, and the automatic logbook
 * write are all real and wired to the database's actual state machine.
 *
 * Motion follows §8: eased and directional, never bouncy. The searching
 * state pulses rather than spins — a spinner implies indeterminate mechanical
 * work; a slow breathing pulse reads as "searching for someone," which is
 * closer to what is actually happening.
 */

import { useEffect } from 'react';
import { Linking, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated } from '@/features/shared/state/session';
import { RatingStars } from '@/features/customer/components/RatingStars';
import type { OrderStatus } from '@/features/shared/data/types';

const TERMINAL: readonly OrderStatus[] = ['completed', 'cancelled', 'disputed'];
const SEARCHING: readonly OrderStatus[] = ['draft', 'searching'];

function SearchingPulse() {
  const theme = useTheme();
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.12, { duration: theme.duration.deliberate, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [scale, theme.duration.deliberate]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={{ alignItems: 'center', paddingVertical: theme.spacing.xl }}>
      <Animated.View
        style={[
          {
            width: 96,
            height: 96,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.primarySubtle,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.primary,
          }}
        />
      </Animated.View>
    </View>
  );
}

export default function TrackingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => repository.getOrder(id ?? ''),
    // Polling stands in for Realtime, which needs a live Supabase project
    // (ADR-0010). The interval stops once the order reaches a terminal
    // status so a finished order does not poll forever in the background.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && TERMINAL.includes(status) ? false : 3000;
    },
  });

  const provider = useQuery({
    queryKey: ['order-provider', order.data?.providerId],
    queryFn: () => repository.getOrderProvider(order.data?.providerId ?? ''),
    enabled: order.data?.providerId !== null && order.data?.providerId !== undefined,
  });

  const parts = useQuery({
    queryKey: ['order-parts', id],
    queryFn: () => repository.listOrderParts(id ?? ''),
    enabled: order.data?.status === 'in_progress' || order.data?.status === 'awaiting_approval',
  });

  const cancel = useMutation({
    mutationFn: () => repository.cancelOrder(id ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  const confirmCompletion = useMutation({
    mutationFn: () => repository.confirmOrderCompletion(id ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  const rate = useMutation({
    mutationFn: (stars: number) =>
      repository.rateOrder({
        orderId: id ?? '',
        providerId: order.data?.providerId ?? '',
        stars,
      }),
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  if (order.isLoading) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {t('common.loading')}
        </Text>
      </Screen>
    );
  }

  if (order.data === null || order.data === undefined) {
    return (
      <Screen>
        <Text variant="heading">{t('tracking.errors.notFound')}</Text>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const { status } = order.data;
  const hasUnapprovedParts = (parts.data ?? []).some((line) => !line.approvedByCustomer);
  const canCancel = !TERMINAL.includes(status) && status !== 'in_progress';

  return (
    <Screen scrollable>
      <Text variant="title">{t('tracking.title')}</Text>

      {SEARCHING.includes(status) ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SearchingPulse />
          <Text variant="heading" align="center">
            {t('tracking.searchingTitle')}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t('tracking.searchingBody')}
          </Text>
        </View>
      ) : (
        <Card elevation="none" style={{ backgroundColor: theme.colors.primarySubtle }}>
          <Text variant="bodyStrong" style={{ color: theme.colors.primary }}>
            {t(`job.status.${status}`)}
          </Text>
        </Card>
      )}

      {provider.data !== null && provider.data !== undefined ? (
        <Card testID="tracking-provider-card">
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" tone="muted">
              {t('tracking.providerCard')}
            </Text>
            <Text variant="bodyStrong">{provider.data.businessNameAr}</Text>
            <Text variant="caption" tone="muted">
              {t('tracking.ratingLabel', {
                rating: provider.data.ratingAvg.toFixed(1),
                count: provider.data.ratingCount,
              })}
            </Text>
            <Button
              label={t('tracking.callAction')}
              variant="secondary"
              size="medium"
              onPress={() => void Linking.openURL('tel:+966500000000')}
            />
          </View>
        </Card>
      ) : null}

      {status === 'in_progress' && hasUnapprovedParts ? (
        <Card
          testID="tracking-quote-banner"
          elevation="none"
          style={{ backgroundColor: theme.colors.accentSubtle }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong" style={{ color: theme.colors.accentText }}>
              {t('tracking.quoteReadyBanner')}
            </Text>
            <Button
              label={t('tracking.reviewQuote')}
              variant="accent"
              size="medium"
              onPress={() => router.push({ pathname: '/quote', params: { id } })}
            />
          </View>
        </Card>
      ) : null}

      {status === 'awaiting_approval' ? (
        <Card testID="tracking-confirm-completion">
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{t('tracking.confirmCompletionTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('tracking.confirmCompletionBody')}
            </Text>
            <Button
              testID="confirm-completion"
              label={t('tracking.confirmCompletionAction')}
              onPress={() => confirmCompletion.mutate()}
              loading={confirmCompletion.isPending}
            />
            {confirmCompletion.isError ? (
              <Text variant="caption" style={{ color: theme.colors.emergency }}>
                {t('tracking.errors.confirmFailed')}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      {status === 'completed' ? (
        <Card testID="tracking-completed">
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="heading">{t('tracking.completedTitle')}</Text>
              <Text variant="body" tone="muted">
                {t('tracking.completedBody')}
              </Text>
            </View>

            {order.data.vehicleId !== null ? (
              <Button
                label={t('tracking.viewLogbook')}
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/logbook', params: { id: order.data?.vehicleId ?? '' } })
                }
              />
            ) : null}

            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" tone="muted">
                {t('tracking.rateTitle')}
              </Text>
              {rate.isSuccess ? (
                <Text variant="body">{t('tracking.rateThanks')}</Text>
              ) : (
                <RatingStars onRate={(stars) => rate.mutate(stars)} disabled={rate.isPending} />
              )}
            </View>
          </View>
        </Card>
      ) : null}

      {status === 'cancelled' ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="heading">{t('tracking.cancelledTitle')}</Text>
        </Card>
      ) : null}

      {canCancel ? (
        <Button
          testID="cancel-order"
          label={t('tracking.cancelAction')}
          variant="ghost"
          onPress={() => cancel.mutate()}
          loading={cancel.isPending}
        />
      ) : null}
    </Screen>
  );
}
