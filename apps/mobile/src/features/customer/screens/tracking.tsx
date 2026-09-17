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
 * Dark is this flow's default rather than a lock — see emergency/_layout.tsx.
 * The design ships light variants of these screens, and an explicit light
 * choice in settings outranks our guess about the hour.
 *
 * Every live figure is optional and the screens render correctly without any
 * of it — see DispatchTelemetry in data/types.ts for why nothing here is
 * stubbed with invented numbers.
 */

import { Share, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BackButton,
  Button,
  Card,
  Row,
  Screen,
  Skeleton,
  SkeletonCard,
  Text,
  ThemeProvider,
  useTheme,
} from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { useIsAuthenticated, useSession } from '@/features/shared/state/session';
import { Arrived } from '@/features/customer/components/tracking/Arrived';
import { Completed } from '@/features/customer/components/tracking/Completed';
import { InProgress } from '@/features/customer/components/tracking/InProgress';
import { LiveTracking } from '@/features/customer/components/tracking/LiveTracking';
import { Matched } from '@/features/customer/components/tracking/Matched';
import { Searching } from '@/features/customer/components/tracking/Searching';
import type { OrderStatus } from '@/features/shared/data/types';

/**
 * Every live state, wrapped so it has a way out.
 *
 * None of them had one. The dispatcher's six branches each rendered their
 * component straight into a bare `<Screen>`, so a customer watching a
 * technician drive toward them could not leave the tracking screen to look at
 * anything else in the app — `fade_from_bottom` leaves no edge-swipe to fall
 * back on, and force-quitting was the only exit. This is the screen people sit
 * on longest in the whole product.
 *
 * Going back does NOT cancel anything: the order is live on the server either
 * way, and the home screen's `ActiveOrderCard` leads straight back here. That
 * is the point — leaving has to be cheap, or watching stops being a choice.
 */
function TrackingFrame({
  backLabel,
  children,
}: {
  readonly backLabel: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Screen scrollable>
      <Row gap="sm" align="center">
        {router.canGoBack() ? (
          <BackButton testID="tracking-back" onPress={() => router.back()} label={backLabel} />
        ) : null}
      </Row>
      {children}
    </Screen>
  );
}

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

  // Dispatch figures for the waiting screen (0042). Polled while matching and
  // stopped the moment it ends — the server returns nothing after that anyway,
  // and there is no reason to keep asking.
  const dispatch = useQuery({
    queryKey: ['order-dispatch', id],
    queryFn: () => repository.getDispatchTelemetry(id ?? ''),
    enabled: SEARCHING.includes(order.data?.status ?? 'draft'),
    refetchInterval: 3000,
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
        {/* This screen is opened by someone who wants to know where their
            technician is. A blank screen with a word on it is the worst
            possible answer to that; the shape of the answer is better. */}
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('common.loading')}
          style={{ gap: theme.spacing.base }}
        >
          <Skeleton testID="tracking-skeleton" height={28} width="60%" />
          <SkeletonCard lines={1} />
          <SkeletonCard lines={2} />
        </View>
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

  const telemetry = dispatch.data ?? undefined;
  const progress = liveProgress.data ?? undefined;

  if (SEARCHING.includes(status)) {
    return (
      <TrackingFrame backLabel={t('common.back')}>
        <Searching
          telemetry={telemetry}
          onCancel={() => cancel.mutate()}
          cancelPending={cancel.isPending}
          cancelFailed={cancel.isError}
        />
      </TrackingFrame>
    );
  }

  if (status === 'quoted') {
    return (
      <TrackingFrame backLabel={t('common.back')}>
        <Matched
          order={current}
          provider={providerData}
          progress={progress}
          onFindAnother={() => cancel.mutate()}
        />
      </TrackingFrame>
    );
  }

  if (status === 'accepted' || status === 'en_route' || status === 'checked_in') {
    return (
      <TrackingFrame backLabel={t('common.back')}>
        <LiveTracking
          order={current}
          provider={providerData}
          progress={progress}
          onShare={() => {
            void Share.share({ message: t('tracking.shareTrip') });
          }}
        />
      </TrackingFrame>
    );
  }

  if (status === 'arrived') {
    return (
      <TrackingFrame backLabel={t('common.back')}>
        <Arrived order={current} provider={providerData} progress={progress} />
      </TrackingFrame>
    );
  }

  if (status === 'in_progress') {
    return (
      <TrackingFrame backLabel={t('common.back')}>
        <InProgress
          order={current}
          provider={providerData}
          progress={progress}
          hasUnapprovedParts={hasUnapprovedParts}
          onReviewQuote={() => router.push({ pathname: '/quote', params: { id } })}
        />
      </TrackingFrame>
    );
  }

  // The customer closes the job, not the provider (ADR-0006), so this state
  // needs its own explicit confirmation rather than folding into `completed`.
  if (status === 'awaiting_approval') {
    return (
      <TrackingFrame backLabel={t('common.back')}>
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
      </TrackingFrame>
    );
  }

  if (status === 'completed') {
    return (
      <TrackingFrame backLabel={t('common.back')}>
        <Completed
          order={current}
          provider={providerData}
          onRate={(stars) => rate.mutate(stars)}
          ratePending={rate.isPending}
          rateSucceeded={rate.isSuccess}
          rateFailed={rate.isError}
          onViewLogbook={() =>
            router.push({ pathname: '/logbook', params: { id: current.vehicleId ?? '' } })
          }
          onDismiss={() => router.replace('/')}
        />
      </TrackingFrame>
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
  const preference = useSession((state) => state.themePreference);

  if (!isAuthenticated) return <Redirect href="/" />;

  return (
    <ThemeProvider locale={locale} preference={preference === 'light' ? 'light' : 'dark'}>
      <TrackingBody />
    </ThemeProvider>
  );
}
