/**
 * دفتر السيارة — the logbook.
 *
 * Build prompt §9.1: "This is the app's soul — design it first, not last."
 *
 * Phase 1 ships the empty state and the event list. Phase 2 adds manual entry,
 * mileage tracking and تقرير هبّة. The empty state is written to explain why
 * the logbook is worth filling, because a customer who does not understand
 * that never comes back to it.
 *
 * Every event renders its provenance (ADR-0005). A Habba-verified service and
 * an owner's recollection must never look the same.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, ProvenanceBadge, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/data/repository';
import type { Provenance } from '@/data/types';
import { useIsAuthenticated } from '@/state/session';

const PROVENANCE_LABEL_KEY: Record<Provenance, string> = {
  habba_verified: 'logbook.verifiedBadge',
  self_reported: 'logbook.selfReportedBadge',
  self_documented: 'logbook.selfDocumentedBadge',
  third_party: 'logbook.thirdPartyBadge',
};

/** Where the public report is served. Replaced by the real domain at launch. */
const REPORT_BASE_URL = 'https://habba.sa/r';

export default function LogbookScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isArabic = i18n.language === 'ar';

  const [reportToken, setReportToken] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => repository.listTimeline(id ?? ''),
    enabled: id !== undefined,
  });

  const report = useMutation({
    mutationFn: () => repository.generateReport(id ?? ''),
    onSuccess: (token) => {
      setReportToken(token);
      setReportError(null);
    },
    onError: (error: Error) => {
      setReportToken(null);
      // A refused report means the logbook failed verification. That is not a
      // transient error and must not invite a retry — it needs support.
      setReportError(
        error.message.includes('failed verification')
          ? t('logbook.errors.reportChainBroken')
          : t('logbook.errors.reportFailed'),
      );
    },
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const events = timeline.data ?? [];

  const verifiedCount = events.filter((event) => event.provenance === 'habba_verified').length;
  const selfReportedCount = events.length - verifiedCount;

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('logbook.title')}</Text>
        {events.length > 0 ? (
          // The honest headline: how much of this history Habba can stand
          // behind. It is also the reason to route the next service through
          // Habba — raising the ratio raises resale value (ADR-0005).
          <Text variant="caption" tone="muted">
            {t('logbook.coverage', {
              verified: verifiedCount,
              selfReported: selfReportedCount,
            })}
          </Text>
        ) : null}
      </View>

      {events.length === 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">{t('logbook.emptyTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('logbook.emptyBody')}
            </Text>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        {events.map((event) => {
          const recordedLater =
            new Date(event.recordedAt).getTime() - new Date(event.occurredAt).getTime() >
            60 * 60 * 1000;

          return (
            <Card key={event.id} testID={`event-${event.id}`}>
              <View style={{ gap: theme.spacing.sm }}>
                <ProvenanceBadge
                  provenance={event.provenance}
                  label={t(PROVENANCE_LABEL_KEY[event.provenance])}
                />

                <Text variant="bodyStrong">{isArabic ? event.summaryAr : event.summaryEn}</Text>

                <View style={{ gap: theme.spacing.xs }}>
                  <Text variant="caption" tone="subtle">
                    {new Date(event.occurredAt).toLocaleDateString(isArabic ? 'ar-SA' : 'en-GB')}
                    {event.mileage !== null
                      ? ` · ${t('logbook.mileageAt', { mileage: event.mileage })}`
                      : ''}
                  </Text>

                  {/* ADR-0012: when an event was recorded materially later than
                      it happened, say so rather than implying live capture. */}
                  {recordedLater ? (
                    <Text variant="caption" tone="subtle">
                      {t('logbook.recordedLater')}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>
          );
        })}
      </View>

      <Button
        testID="record-service"
        label={t('logbook.addRecord')}
        variant={events.length === 0 ? 'primary' : 'secondary'}
        onPress={() => router.push({ pathname: '/record-service', params: { id } })}
      />

      {/* تقرير هبّة is only meaningful once there is history to report on. */}
      {events.length > 0 ? (
        <>
          <Button
            testID="generate-report"
            label={t('logbook.generateReport')}
            variant="accent"
            onPress={() => report.mutate()}
            loading={report.isPending}
          />

          {reportToken !== null ? (
            <Card elevation="sm">
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="bodyStrong">{t('logbook.reportReady')}</Text>
                <Text variant="caption" tone="muted">
                  {t('logbook.reportShareHint')}
                </Text>
                <Text variant="caption" style={{ color: theme.colors.primary }} selectable>
                  {`${REPORT_BASE_URL}/${reportToken}`}
                </Text>
                <Text variant="caption" tone="subtle">
                  {t('logbook.reportCoverage', {
                    verified: verifiedCount,
                    total: events.length,
                  })}
                </Text>
              </View>
            </Card>
          ) : null}

          {reportError !== null ? (
            <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
              <Text variant="caption" style={{ color: theme.colors.emergency }}>
                {reportError}
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
