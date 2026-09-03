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

import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, Icon, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { OpenJobCard } from '@/components/OpenJobCard';
import { ShiftStatusCard } from '@/components/ShiftStatusCard';
import { providerRepository } from '@/data/provider-repository';
import { isBroadcastStale, LOCATION_INTERVAL_MS, useShift } from '@/state/shift';

export default function ShiftScreen() {
  const { t } = useTranslation();
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

  const toggle = useMutation({
    mutationFn: (next: boolean) => providerRepository.setOnline(next),
    onSuccess: async (_data, next) => {
      setOnline(next);
      await queryClient.invalidateQueries({ queryKey: ['open-jobs'] });
    },
  });

  // Position broadcast, only while online.
  useEffect(() => {
    if (!isOnline) return;

    let cancelled = false;

    const push = async () => {
      try {
        const position = await providerRepository.currentPosition();
        await providerRepository.broadcastLocation(position);
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

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <Text variant="title">{t('provider.shiftTitle')}</Text>

      <ShiftStatusCard
        testID="shift-status"
        isOnline={isOnline}
        busy={toggle.isPending}
        onToggle={() => toggle.mutate(!isOnline)}
      />

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
