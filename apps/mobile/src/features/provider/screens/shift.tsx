/**
 * The shift screen — online toggle and open jobs.
 *
 * Build prompt §9.2: the toggle is prominent, and location broadcasts only
 * while online.
 *
 * The open-jobs list shows a distance BUCKET and a district, never an address
 * (ADR-0013). That is not a UI preference: the API physically will not return
 * the address before acceptance, so this screen renders everything there is.
 */

import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Row, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { OpenJobCard } from '@/features/provider/components/OpenJobCard';
import { InitialBadge, PRO_HERO } from '@/features/provider/components/ProParts';
import { useProviderDashboard } from '@/features/provider/hooks/use-dashboard';
import { greetingKeyNow } from '@/features/shared/lib/greeting';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { ShiftStatusCard } from '@/features/provider/components/ShiftStatusCard';
import { providerRepository } from '@/features/provider/data/provider-repository';
import { useLiveRefresh } from '@/features/shared/lib/live';
import { locationProvider } from '@/features/shared/lib/location';
import { registerThisDevice, type PushRegistration } from '@/features/shared/lib/push';
import { isBroadcastStale, LOCATION_INTERVAL_MS, useShift } from '@/features/provider/state/shift';

export default function ShiftScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const isOnline = useShift((state) => state.isOnline);
  const setOnline = useShift((state) => state.setOnline);
  const lastBroadcastAt = useShift((state) => state.lastBroadcastAt);
  const markBroadcast = useShift((state) => state.markBroadcast);
  const setBroadcastError = useShift((state) => state.setBroadcastError);

  /**
   * Opening a job records that this provider looked at it (0043).
   *
   * Fire-and-forget: the customer's "reviewing" counter is the only thing that
   * depends on it, and a technician must never be blocked from opening a job
   * because a telemetry write failed.
   */
  const openJob = useCallback((orderId: string) => {
    void providerRepository.markOfferViewed(orderId);
    router.push({ pathname: '/job', params: { id: orderId } });
  }, []);

  const openJobs = useQuery({
    queryKey: ['open-jobs'],
    queryFn: () => providerRepository.listOpenJobs(),
    enabled: isOnline,
    // Dispatch is a live queue; a stale list means chasing a job someone else
    // already took.
    refetchInterval: isOnline ? 10_000 : false,
  });

  /**
   * Whether this phone can be reached with the app closed. Null until the
   * technician first goes online in this session — that is when it is asked.
   */
  const [push, setPush] = useState<PushRegistration | null>(null);

  const toggle = useMutation({
    mutationFn: (next: boolean) => providerRepository.setOnline(next),
    onSuccess: async (_data, next) => {
      setOnline(next);
      await queryClient.invalidateQueries({ queryKey: ['open-jobs'] });
      // Going online is when it explains itself: "tell me about new jobs".
      if (next) setPush(await registerThisDevice({ prompt: true, locale: i18n.language }));
    },
  });

  // A new offer reaches an online technician the moment it is made — a
  // 10-second poll is a long time in a race with other technicians. RLS
  // delivers only this technician's own offers.
  useLiveRefresh([{ table: 'order_offers' }], [['open-jobs']], isOnline);

  // Position broadcast, only while online.
  useEffect(() => {
    if (!isOnline) return;

    let cancelled = false;

    const push = async () => {
      try {
        // The phone's real position: without one the matcher cannot place this
        // technician, and no emergency is ever offered to them.
        const fix = await locationProvider.getCurrentLocation();
        if (!fix.ok) throw new Error(fix.reason);
        await providerRepository.broadcastLocation(fix.location);
        if (!cancelled) markBroadcast(Date.now());
      } catch (error) {
        if (!cancelled) {
          setBroadcastError(error instanceof Error ? error.message : 'unknown');
        }
      }
    };

    void push();
    const timer = setInterval(() => void push(), LOCATION_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOnline, markBroadcast, setBroadcastError]);

  const stale = isOnline && isBroadcastStale(lastBroadcastAt);

  const jobs = openJobs.data ?? [];
  const dashboard = useProviderDashboard();
  const profile = dashboard.data?.profile;
  const today = dashboard.data?.periods.today;
  const businessName =
    profile === undefined
      ? ''
      : i18n.language.startsWith('ar')
        ? profile.businessNameAr
        : (profile.businessNameEn ?? profile.businessNameAr);

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      {/* Who is working, and how the day is going — the two things a
          technician checks before anything else. The way back to the
          customer side lives on the profile tab (§5.1.4), one tap away. */}
      <Row gap="md">
        <View style={{ flex: 1 }}>
          <Text variant="bodySmall" tone="muted">
            {t(`home.${greetingKeyNow()}`)}
          </Text>
          <Text variant="title" numberOfLines={1}>
            {businessName.length > 0 ? businessName : t('provider.shiftTitle')}
          </Text>
        </View>
        <Pressable
          testID="shift-profile"
          onPress={() => router.push('/pro')}
          accessibilityRole="button"
          accessibilityLabel={t('pro.navProfile')}
          style={({ pressed }) => (pressed ? { opacity: 0.8 } : null)}
        >
          <InitialBadge name={businessName} size={44} />
        </Pressable>
      </Row>

      {/* Today at a glance; the full picture is one tap away. */}
      <Pressable
        testID="shift-today"
        onPress={() => router.push('/earnings')}
        accessibilityRole="button"
        accessibilityLabel={t('pro.todayTitle')}
        style={({ pressed }) => (pressed ? { opacity: 0.9 } : null)}
      >
        <View
          style={{
            borderRadius: theme.radius.xl,
            padding: theme.spacing.base,
            gap: theme.spacing.md,
            backgroundColor: PRO_HERO,
          }}
        >
          <Row gap="sm">
            <Text variant="label" style={{ flex: 1, color: 'rgba(255,255,255,0.8)' }}>
              {t('pro.todayTitle')}
            </Text>
            <Icon name="chevronForward" size={theme.iconSize.sm} color="rgba(255,255,255,0.7)" />
          </Row>
          <Row gap="md" align="stretch">
            <TodayFigure
              label={t('pro.statNet')}
              value={
                today === undefined
                  ? '—'
                  : `${formatSarDisplay(today.net)} ${t('provider.sarSuffix')}`
              }
              strong
            />
            <TodayFigure
              label={t('pro.statJobs')}
              value={today === undefined ? '—' : String(today.jobs)}
            />
            <TodayFigure
              label={t('pro.statRating')}
              value={
                profile === undefined
                  ? '—'
                  : profile.ratingCount === 0
                    ? t('pro.noRating')
                    : `★ ${profile.ratingAvg.toFixed(1)}`
              }
            />
          </Row>
        </View>
      </Pressable>

      <ShiftStatusCard
        testID="shift-status"
        isOnline={isOnline}
        busy={toggle.isPending}
        onToggle={() => toggle.mutate(!isOnline)}
      />

      {/* Online but unreachable while closed is the case that quietly costs a
          technician their jobs — so it is said, with the way out. A simulator
          or a build without push configured is not the technician's to fix,
          and is not nagged about. */}
      {isOnline && push !== null && !push.ok && push.reason === 'denied' ? (
        <Card
          testID="shift-push-off"
          elevation="none"
          style={{ backgroundColor: theme.colors.surfaceSunken }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodySmall" tone="warning">
              {t('provider.pushOff')}
            </Text>
            <Button
              label={t('provider.pushOffSettings')}
              variant="secondary"
              size="medium"
              onPress={() => void Linking.openSettings()}
            />
          </View>
        </Card>
      ) : null}

      {/* Online but invisible to dispatch is the state worth shouting about:
          the technician believes they are working and nothing is arriving,
          and silence looks exactly like a quiet night. */}
      {stale ? (
        <Card
          testID="location-stale"
          elevation="none"
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            gap: theme.spacing.md,
            backgroundColor: theme.colors.warningSubtle,
            borderColor: theme.colors.warning,
            borderWidth: 1,
          }}
        >
          <Icon name="alert" size={theme.iconSize.md} color={theme.colors.warningFg} />
          <Text variant="bodySmall" tone="warning" style={{ flex: 1 }}>
            {t('provider.locationStale')}
          </Text>
        </Card>
      ) : null}

      {/* Off shift: one piece of practice that protects the technician,
          instead of an empty screen. */}
      {!isOnline ? (
        <Card
          testID="shift-tip"
          elevation="none"
          style={{ borderWidth: 1, borderColor: theme.colors.border }}
        >
          <Row gap="md" align="flex-start">
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.accentSubtle,
              }}
            >
              <Icon name="inspection" size={theme.iconSize.sm} color={theme.colors.accentFg} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label">{t('pro.tipTitle')}</Text>
              <Text variant="caption" tone="muted">
                {t('pro.tipEvidence')}
              </Text>
            </View>
          </Row>
        </Card>
      ) : null}

      {isOnline ? (
        <View style={{ gap: theme.spacing.md }}>
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              alignItems: 'baseline',
              gap: theme.spacing.sm,
            }}
          >
            <Text variant="subheading" style={{ flex: 1 }}>
              {t('provider.openJobs')}
            </Text>
            {jobs.length > 0 ? (
              <Text variant="caption" tone="muted" numeric>
                {t('provider.openJobsCount', { count: jobs.length })}
              </Text>
            ) : null}
          </View>

          {jobs.length === 0 ? (
            <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
              <Text variant="bodySmall" tone="muted">
                {t('provider.noOpenJobs')}
              </Text>
            </Card>
          ) : (
            jobs.map((job) => (
              <OpenJobCard
                key={job.orderId}
                testID={`job-${job.orderId}`}
                job={job}
                onPress={() => openJob(job.orderId)}
              />
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function TodayFigure({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}) {
  return (
    <View style={{ flex: strong ? 1.4 : 1, gap: 2 }}>
      <Text
        variant={strong ? 'heading' : 'bodyStrong'}
        numeric
        numberOfLines={1}
        style={{ color: '#FFFFFF' }}
      >
        {value}
      </Text>
      <Text variant="caption" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.7)' }}>
        {label}
      </Text>
    </View>
  );
}
