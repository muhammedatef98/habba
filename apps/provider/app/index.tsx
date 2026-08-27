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

import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
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

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('provider.shiftTitle')}</Text>
        <Text variant="body" tone="muted">
          {isOnline ? t('provider.onlineHint') : t('provider.offlineHint')}
        </Text>
      </View>

      <Button
        testID="online-toggle"
        label={isOnline ? t('provider.goOffline') : t('provider.goOnline')}
        variant={isOnline ? 'secondary' : 'primary'}
        onPress={() => toggle.mutate(!isOnline)}
        loading={toggle.isPending}
      />

      {/* Online but invisible to dispatch is the state worth shouting about:
          the technician believes they are working and nothing is arriving,
          and silence looks exactly like a quiet night. */}
      {stale ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="caption" style={{ color: theme.colors.warning }}>
            {t('provider.locationStale')}
          </Text>
        </Card>
      ) : null}

      {isOnline ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t('provider.openJobs')}</Text>

          {(openJobs.data ?? []).length === 0 ? (
            <Text variant="body" tone="muted">
              {t('provider.noOpenJobs')}
            </Text>
          ) : null}

          {(openJobs.data ?? []).map((job) => (
            <Pressable
              key={job.orderId}
              testID={`job-${job.orderId}`}
              onPress={() => router.push({ pathname: '/job', params: { id: job.orderId } })}
              accessibilityRole="button"
              accessibilityLabel={job.serviceNameAr}
            >
              <Card>
                <View style={{ gap: theme.spacing.xs }}>
                  <Text variant="heading">{job.serviceNameAr}</Text>
                  <Text variant="caption" tone="muted">
                    {/* Bucket and district. There is no address to show yet. */}
                    {job.distanceBucket}
                    {job.districtNameAr === null ? '' : ` · ${job.districtNameAr}`}
                  </Text>
                  {job.problemSummary.length > 0 ? (
                    <Text variant="caption" tone="subtle">
                      {job.problemSummary}
                    </Text>
                  ) : null}
                  <Text variant="bodyStrong" style={{ color: theme.colors.primary }}>
                    {t('provider.estimatedPayout', { amount: job.estimatedPayout ?? '—' })}
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Button
        label={t('provider.myJobs')}
        variant="ghost"
        onPress={() => router.push('/my-jobs')}
      />
    </Screen>
  );
}
