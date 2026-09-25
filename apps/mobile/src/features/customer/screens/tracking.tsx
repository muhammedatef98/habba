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
import { useLiveRefresh } from '@/features/shared/lib/live';
import { useIsAuthenticated, useSession } from '@/features/shared/state/session';
import { EvidencePhoto } from '@/features/shared/components/EvidencePhoto';
import { Arrived } from '@/features/customer/components/tracking/Arrived';
import { Booked } from '@/features/customer/components/tracking/Booked';
import { Completed } from '@/features/customer/components/tracking/Completed';
import { InProgress } from '@/features/customer/components/tracking/InProgress';
import { LiveTracking } from '@/features/customer/components/tracking/LiveTracking';
import { Matched } from '@/features/customer/components/tracking/Matched';
import { PriceBreakdown } from '@/features/customer/components/tracking/PriceBreakdown';
import { ReportProblem } from '@/features/customer/components/tracking/ReportProblem';
import { InspectionReportCard } from '@/features/customer/components/tracking/InspectionReportCard';
import { Searching } from '@/features/customer/components/tracking/Searching';
import type { OrderStatus } from '@/features/shared/data/types';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { agreedTotal } from '@/features/shared/lib/order-price';

const TERMINAL: readonly OrderStatus[] = ['completed', 'cancelled', 'disputed'];
const SEARCHING: readonly OrderStatus[] = ['searching'];

function TrackingBody() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  // The same query the service screen ran a moment ago, so a cache hit: it
  // names the service on the searching screen.
  const services = useQuery({
    queryKey: ['emergency-services'],
    queryFn: () => repository.listEmergencyServices(),
  });

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
    // Its failure is shown in place, not as a toast.

    meta: { inlineError: true },
    mutationFn: () => repository.cancelOrder(id ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  // Sends an order that was created but never sent — the app closed, or the
  // payment hold failed, between the two steps. Idempotent server-side.
  const send = useMutation({
    // Its failure is shown in place, not as a toast.
    meta: { inlineError: true },
    mutationFn: () => repository.submitOrder(id ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  const confirmCompletion = useMutation({
    // Its failure is shown in place, not as a toast.

    meta: { inlineError: true },
    mutationFn: () => repository.confirmOrderCompletion(id ?? ''),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  // How long before an unconfirmed job closes by itself — the operators'
  // setting (0071), shown so the customer is not surprised by it.
  // An inspection order's report, once filed (0026). Asked for only when the
  // work is done; most orders have none, and the answer is then null.
  const inspection = useQuery({
    queryKey: ['order-inspection', id],
    queryFn: () => repository.getOrderInspection(id ?? ''),
    enabled:
      id !== undefined &&
      (order.data?.status === 'awaiting_approval' || order.data?.status === 'completed'),
  });

  // The tax invoice, issued with completion (0074). Asked for only then.
  const invoice = useQuery({
    queryKey: ['order-invoice', id],
    queryFn: () => repository.getOrderInvoice(id ?? ''),
    enabled: id !== undefined && order.data?.status === 'completed',
  });

  // Whether this order was rated already — it is opened again from the
  // history long after the job, and must not ask twice.
  const givenRating = useQuery({
    queryKey: ['order-rating', id],
    queryFn: () => repository.getOrderRating(id ?? ''),
    enabled: id !== undefined && order.data?.status === 'completed',
  });

  const platform = useQuery({
    queryKey: ['platform-status'],
    queryFn: () => repository.getPlatformStatus(),
    staleTime: 60_000,
  });

  const rate = useMutation({
    // Its failure is shown in place, not as a toast.

    meta: { inlineError: true },
    mutationFn: (stars: number) =>
      repository.rateOrder({
        orderId: id ?? '',
        providerId: order.data?.providerId ?? '',
        stars,
      }),
    onSuccess: (_, stars) => queryClient.setQueryData(['order-rating', id], stars),
  });

  // The status, the parts and the technician's approach the moment they
  // change, not a poll later (lib/live.ts).
  useLiveRefresh(
    [
      { table: 'orders', filter: `id=eq.${id ?? ''}` },
      { table: 'order_parts', filter: `order_id=eq.${id ?? ''}` },
    ],
    [
      ['order', id],
      ['order-parts', id],
      ['order-progress', id],
    ],
    id !== undefined,
  );

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
  const hasUnapprovedParts = (parts.data ?? []).some(
    (line) => !line.approvedByCustomer && line.declinedAt === null,
  );

  const telemetry = dispatch.data ?? undefined;
  const progress = liveProgress.data ?? undefined;

  // Created but not sent. Nobody can see it yet, so this must not look like a
  // search — it says so, and offers the one tap that finishes it.
  if (status === 'draft') {
    return (
      <Screen scrollable>
        <Card testID="tracking-not-sent">
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{t('tracking.notSentTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('tracking.notSentBody')}
            </Text>
            <Button
              testID="tracking-send"
              label={t('tracking.notSentAction')}
              onPress={() => send.mutate()}
              loading={send.isPending}
            />
            {send.isError ? (
              <Text variant="caption" tone="emergency">
                {t('tracking.notSentFailed')}
              </Text>
            ) : null}
          </View>
        </Card>
        <Button
          label={t('tracking.cancelAction')}
          variant="ghost"
          onPress={() => cancel.mutate()}
          loading={cancel.isPending}
        />
      </Screen>
    );
  }

  const booked = current.fulfilmentMode !== 'mobile_ondemand';

  if (booked && status === 'accepted') {
    return (
      <Screen scrollable>
        <Booked
          order={current}
          provider={providerData}
          onCancel={() => cancel.mutate()}
          cancelPending={cancel.isPending}
        />
      </Screen>
    );
  }

  if (SEARCHING.includes(status)) {
    return (
      <Screen scrollable>
        <Searching
          telemetry={telemetry}
          onCancel={() => cancel.mutate()}
          cancelPending={cancel.isPending}
          cancelFailed={cancel.isError}
          summary={{
            service: (() => {
              const service = services.data?.find(
                (candidate) => candidate.id === current.serviceId,
              );
              if (service === undefined) return null;
              return i18n.language.startsWith('ar') ? service.nameAr : service.nameEn;
            })(),
            address: current.serviceAddressAr,
            held: (() => {
              const total = agreedTotal(current);
              return total === null ? null : formatSarDisplay(total);
            })(),
          }}
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

  if (status === 'accepted' || status === 'en_route') {
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

  // A car checked in at the workshop is with the provider now: the same
  // "work underway" view, not a live map of a drive that is not happening.
  if (status === 'in_progress' || status === 'checked_in') {
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

            {/* What they are approving, before they approve it: the photos
                of the work, what it costs, and what is guaranteed. */}
            {current.completionMedia.length > 0 ? (
              <Row gap="sm" wrap>
                {current.completionMedia.map((photo) => (
                  <EvidencePhoto
                    key={photo.url}
                    reference={photo.url}
                    size={72}
                    accessibilityLabel={photo.caption ?? t('tracking.evidenceTitle')}
                  />
                ))}
              </Row>
            ) : null}

            {inspection.data !== null && inspection.data !== undefined ? (
              <InspectionReportCard inspection={inspection.data} orderCompleted={false} />
            ) : null}

            <PriceBreakdown testID="approval-breakdown" order={current} />

            {current.warrantyDays !== null && current.warrantyDays > 0 ? (
              <Text testID="approval-warranty" variant="bodySmall" tone="success">
                {t('tracking.warrantyLine', { count: current.warrantyDays })}
              </Text>
            ) : null}

            {platform.data !== undefined ? (
              <Text testID="auto-complete-note" variant="caption" tone="muted">
                {t('tracking.autoCompleteNote', { count: platform.data.autoCompleteHours })}
              </Text>
            ) : null}

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
          rateFailed={rate.isError}
          onViewLogbook={() =>
            router.push({ pathname: '/logbook', params: { id: current.vehicleId ?? '' } })
          }
          onDismiss={() => router.replace('/')}
          invoice={invoice.data ?? null}
          // Unknown reads as "not rated": a failed read must not hide the stars.
          givenRating={givenRating.isError ? null : givenRating.data}
        />
        {inspection.data !== null && inspection.data !== undefined ? (
          <InspectionReportCard inspection={inspection.data} orderCompleted />
        ) : null}
        <ReportProblem orderId={current.id} />
      </Screen>
    );
  }

  // A complaint is not a cancellation. This used to fall through to the
  // cancelled card below, telling a customer whose complaint was being
  // reviewed that their order had been cancelled.
  if (status === 'disputed') {
    return (
      <Screen scrollable>
        <Card testID="order-disputed" elevation="sm" style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t('tracking.disputedTitle')}</Text>
          <Text variant="bodySmall" tone="muted">
            {t('tracking.disputedBody')}
          </Text>
        </Card>
        <PriceBreakdown order={current} />
        <Button label={t('common.back')} variant="ghost" onPress={() => router.replace('/')} />
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
  const preference = useSession((state) => state.themePreference);

  if (!isAuthenticated) return <Redirect href="/" />;

  return (
    <ThemeProvider locale={locale} preference={preference === 'light' ? 'light' : 'dark'}>
      <TrackingBody />
    </ThemeProvider>
  );
}
