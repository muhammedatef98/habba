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
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Screen, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { OpenJobCard } from '@/features/provider/components/OpenJobCard';
import { ShiftStatusCard } from '@/features/provider/components/ShiftStatusCard';
import { providerRepository } from '@/features/provider/data/provider-repository';
import {
  isBroadcastBlocked,
  isBroadcastStale,
  LOCATION_INTERVAL_MS,
  useShift,
} from '@/features/provider/state/shift';
import { useMode } from '@/features/shared/state/mode';

export default function ShiftScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const setMode = useMode((state) => state.setMode);
  const isOnline = useShift((state) => state.isOnline);
  const setOnline = useShift((state) => state.setOnline);
  const lastBroadcastAt = useShift((state) => state.lastBroadcastAt);
  const broadcastError = useShift((state) => state.broadcastError);
  const markBroadcast = useShift((state) => state.markBroadcast);
  const setBroadcastError = useShift((state) => state.setBroadcastError);

  /**
   * Bumped to restart the broadcast loop after it has given up.
   *
   * A denial stops the loop, and granting permission in Settings does not tell
   * this screen anything — so without a way back the technician fixes the
   * permission and still receives nothing until they kill the app.
   */
  const [retryKey, setRetryKey] = useState(0);

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
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopTimer = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const push = async () => {
      const fix = await providerRepository.currentPosition();
      if (cancelled) return;

      if (!fix.ok) {
        setBroadcastError(fix.reason);
        // Asking a denied permission again every twenty seconds wakes the GPS
        // for an answer that cannot change, on the phone whose battery is this
        // person's working day. The card below is the only thing that fixes it.
        if (isBroadcastBlocked(fix.reason)) stopTimer();
        return;
      }

      try {
        await providerRepository.broadcastLocation(fix.position);
        if (!cancelled) markBroadcast(Date.now());
      } catch {
        // A fix was obtained and the server would not take it — the network, or
        // an account that is no longer approved. Both are worth retrying.
        if (!cancelled) setBroadcastError('rejected');
      }
    };

    void push();
    timer = setInterval(() => void push(), LOCATION_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopTimer();
    };
  }, [isOnline, retryKey, markBroadcast, setBroadcastError]);

  const stale = isOnline && isBroadcastStale(lastBroadcastAt);

  /**
   * What to say about a position that is not reaching dispatch.
   *
   * The named reason wins over staleness, because it is the actionable one:
   * "your location is old" and "you denied location access" send the technician
   * to completely different places, and only one of them is a fix.
   */
  const locationProblemKey = !isOnline
    ? null
    : broadcastError === 'permission_denied'
      ? 'provider.locationDenied'
      : broadcastError === 'rejected'
        ? 'provider.locationRejected'
        : broadcastError === 'unavailable'
          ? 'provider.locationUnavailable'
          : stale
            ? 'provider.locationStale'
            : null;

  const jobs = openJobs.data ?? [];

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <Text variant="title">{t('provider.shiftTitle')}</Text>

      {/* The way back to the customer side (§5.1.4). A technician owns a car
          too, and their own logbook must never be more than one tap away. */}
      <Button
        testID="switch-to-customer"
        label={t('profile.switchToCustomer')}
        variant="ghost"
        size="medium"
        onPress={() => {
          setMode('customer');
          router.replace('/vehicles');
        }}
      />

      <ShiftStatusCard
        testID="shift-status"
        isOnline={isOnline}
        busy={toggle.isPending}
        onToggle={() => toggle.mutate(!isOnline)}
      />

      {/* Online but invisible to dispatch is the state worth shouting about:
          the technician believes they are working and nothing is arriving,
          and silence looks exactly like a quiet night. */}
      {locationProblemKey !== null ? (
        <Card
          testID="location-stale"
          elevation="none"
          style={{
            gap: theme.spacing.md,
            backgroundColor: theme.colors.warningSubtle,
            borderColor: theme.colors.warning,
            borderWidth: 1,
          }}
        >
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              gap: theme.spacing.md,
            }}
          >
            <Icon name="alert" size={theme.iconSize.md} color={theme.colors.warningFg} />
            <Text variant="bodySmall" tone="warning" style={{ flex: 1 }}>
              {t(locationProblemKey)}
            </Text>
          </View>

          {/* Only for the denial: it is the one failure with a fix that lives
              outside this app, and the one where the loop has stopped. */}
          {broadcastError === 'permission_denied' ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Button
                testID="open-location-settings"
                label={t('provider.openSettings')}
                variant="secondary"
                size="medium"
                onPress={() => void Linking.openSettings()}
              />
              <Button
                testID="retry-location"
                label={t('provider.retryLocation')}
                variant="ghost"
                size="medium"
                onPress={() => {
                  setBroadcastError(null);
                  setRetryKey((key) => key + 1);
                }}
              />
            </View>
          ) : null}
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
