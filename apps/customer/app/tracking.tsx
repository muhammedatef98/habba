/**
 * Live tracking — §8: "the emotional core of the product. Invest in it."
 *
 * This file is a dispatcher, not a screen. The design (`Habba Emergency Flow`,
 * screens 05–08c) is six distinct states, and each one is its own component
 * under `src/components/tracking/`. What lives here is the data: one polled
 * order query, the provider and parts reads that hang off it, and the four
 * mutations. Keeping the queries in one place means the six states cannot
 * disagree about what the order says.
 *
 * Dark is this flow's default theme rather than the device's — most emergencies
 * happen after sunset, and a white screen at night on the hard shoulder is
 * hostile. The nested ThemeProvider scopes that to this route.
 *
 * The map and the live provider position are still open work (react-native-maps
 * plus a customer read of provider_locations), as is the dispatch telemetry
 * behind screen 05. Every one of those is modelled as optional data and the
 * screens render correctly without it — see DispatchTelemetry in data/types.ts
 * for why nothing here is stubbed with invented numbers.
 */

import { Share, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, ThemeProvider, useTheme } from '@habba/ui';
import { repository } from '@/data/repository';
import { useIsAuthenticated, useSession } from '@/state/session';
import { Arrived } from '@/components/tracking/Arrived';
import { Completed } from '@/components/tracking/Completed';
import { InProgress } from '@/components/tracking/InProgress';
import { LiveTracking } from '@/components/tracking/LiveTracking';
import { Matched } from '@/components/tracking/Matched';
import { Searching } from '@/components/tracking/Searching';
import type { OrderStatus } from '@/data/types';

const TERMINAL: readonly OrderStatus[] = ['completed', 'cancelled', 'disputed'];
const SEARCHING: readonly OrderStatus[] = ['draft', 'searching'];

function TrackingBody() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
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

  // Distance, ETA and the handover code (migration 0040). Polled on the same
  // cadence as the order: a position that updates faster than the status it is
  // attached to would show a technician still approaching a job that has ended.
  const liveProgress = useQuery({
    queryKey: ['order-progress', id],
    queryFn: () => repository.getOrderProgress(id ?? ''),
    enabled: order.data?.providerId !== null && order.data?.providerId !== undefined,
    refetchInterval: (query) => {
      const status = query.state.data === undefined ? undefined : order.data?.status;
      return status !== undefined && TERMINAL.includes(status) ? false : 3000;
    },
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

  const current = order.data;
  const { status } = current;
  const providerData = provider.data ?? null;
  const hasUnapprovedParts = (parts.data ?? []).some((line) => !line.approvedByCustomer);

  // Dispatch telemetry (screen 05's counters and log) still has nothing behind
  // it — there is no table recording which providers were offered the job, so
  // the counts are not derivable. Read as undefined rather than invented.
  const telemetry = undefined;

  const progress = liveProgress.data ?? undefined;

  if (SEARCHING.includes(status)) {
    return (
      <Screen scrollable>
        <Searching
          telemetry={telemetry}
          onCancel={() => cancel.mutate()}
          cancelPending={cancel.isPending}
        />
      </Screen>
    );
  }

  if (status === 'quoted') {
    return (
      <Screen scrollable>
        <Matched
          order={current}
          provider={providerData}
          progress={progress}
          onFindAnother={() => cancel.mutate()}
        />
      </Screen>
    );
  }

  if (status === 'accepted' || status === 'en_route' || status === 'checked_in') {
    return (
      <Screen scrollable>
        <LiveTracking
          order={current}
          provider={providerData}
          progress={progress}
          onShare={() => {
            void Share.share({ message: t('tracking.shareTrip') });
          }}
        />
      </Screen>
    );
  }

  if (status === 'arrived') {
    return (
      <Screen scrollable>
        <Arrived order={current} provider={providerData} progress={progress} />
      </Screen>
    );
  }

  if (status === 'in_progress') {
    return (
      <Screen scrollable>
        <InProgress
          order={current}
          provider={providerData}
          progress={progress}
          hasUnapprovedParts={hasUnapprovedParts}
          onReviewQuote={() => router.push({ pathname: '/quote', params: { id } })}
        />
      </Screen>
    );
  }

  // The customer closes the job, not the provider (ADR-0006), so this state
  // needs its own explicit confirmation rather than folding into `completed`.
  if (status === 'awaiting_approval') {
    return (
      <Screen scrollable>
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
              <Text variant="caption" tone="emergency">
                {t('tracking.errors.confirmFailed')}
              </Text>
            ) : null}
          </View>
        </Card>
      </Screen>
    );
  }

  if (status === 'completed') {
    return (
      <Screen scrollable>
        <Completed
          order={current}
          provider={providerData}
          onRate={(stars) => rate.mutate(stars)}
          ratePending={rate.isPending}
          rateSucceeded={rate.isSuccess}
          onViewLogbook={() =>
            router.push({ pathname: '/logbook', params: { id: current.vehicleId ?? '' } })
          }
          onDismiss={() => router.replace('/')}
        />
      </Screen>
    );
  }

  return (
    <Screen scrollable>
      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <Text variant="heading">{t('tracking.cancelledTitle')}</Text>
      </Card>
      <Button label={t('common.back')} variant="ghost" onPress={() => router.replace('/')} />
    </Screen>
  );
}

export default function TrackingScreen() {
  const isAuthenticated = useIsAuthenticated();
  // The locale still comes from the session — only the light/dark preference is
  // overridden here. Pinning the locale too would silently force Arabic on an
  // English user the moment they opened a tracking screen.
  const locale = useSession((state) => state.locale);

  if (!isAuthenticated) return <Redirect href="/" />;

  return (
    <ThemeProvider locale={locale} preference="dark">
      <TrackingBody />
    </ThemeProvider>
  );
}
