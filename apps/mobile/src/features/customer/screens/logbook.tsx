/**
 * دفتر السيارة — the logbook.
 *
 * Build prompt §9.1: "This is the app's soul — design it first, not last."
 *
 * Chronological, newest first, grouped by year. The grouping is not decoration:
 * a well-kept logbook runs to dozens of entries over a car's life, and "what
 * happened in 2024" is how an owner — and a buyer — actually reads it. The year
 * header carries that year's entry count and its verified share, so the shape
 * of the history is visible without opening anything.
 *
 * Every event renders its provenance (ADR-0005). A Habba-verified service and
 * an owner's recollection must never look the same.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ProvenanceBadge, Screen, Text, useTheme } from '@habba/ui';
import { reportBaseUrl } from '@/features/shared/lib/config';
import { repository } from '@/features/shared/data/repository';
import type { Provenance, TimelineEvent } from '@/features/shared/data/types';
import { useIsAuthenticated } from '@/features/shared/state/session';

const PROVENANCE_LABEL_KEY: Record<Provenance, string> = {
  habba_verified: 'logbook.verifiedBadge',
  self_reported: 'logbook.selfReportedBadge',
  self_documented: 'logbook.selfDocumentedBadge',
  third_party: 'logbook.thirdPartyBadge',
};

interface YearGroup {
  readonly year: number;
  readonly events: readonly TimelineEvent[];
  readonly verified: number;
}

/**
 * Groups by the year the service HAPPENED, not the year it was recorded.
 * An owner entering ten years of history in one sitting must see ten years,
 * not one.
 */
function groupByYear(events: readonly TimelineEvent[]): readonly YearGroup[] {
  const byYear = new Map<number, TimelineEvent[]>();

  for (const event of events) {
    const year = new Date(event.occurredAt).getFullYear();
    const bucket = byYear.get(year);
    if (bucket === undefined) byYear.set(year, [event]);
    else bucket.push(event);
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, group]) => ({
      year,
      events: [...group].sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      ),
      verified: group.filter((event) => event.provenance === 'habba_verified').length,
    }));
}

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

  const events = useMemo(() => timeline.data ?? [], [timeline.data]);
  const groups = useMemo(() => groupByYear(events), [events]);

  if (!isAuthenticated) return <Redirect href="/" />;

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
        <EmptyState
          testID="logbook-empty"
          title={t('logbook.emptyTitle')}
          body={t('logbook.emptyBody')}
          actionLabel={t('logbook.emptyAction')}
          onAction={() => router.push({ pathname: '/record-service', params: { id } })}
          secondaryActionLabel={t('logbook.mileageAction')}
          onSecondaryAction={() => router.push({ pathname: '/mileage', params: { id } })}
        />
      ) : null}

      {groups.map((group) => (
        <View key={group.year} style={{ gap: theme.spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: theme.spacing.sm,
            }}
          >
            <Text variant="heading">{group.year}</Text>
            <Text variant="caption" tone="subtle">
              {t('logbook.yearSummary', {
                count: group.events.length,
                verified: group.verified,
              })}
            </Text>
          </View>

          {group.events.map((event) => {
            const recordedLater =
              new Date(event.recordedAt).getTime() - new Date(event.occurredAt).getTime() >
              60 * 60 * 1000;

            return (
              <Card
                key={event.id}
                testID={`event-${event.id}`}
                onPress={() =>
                  router.push({ pathname: '/event', params: { id, eventId: event.id } })
                }
                accessibilityLabel={isArabic ? event.summaryAr : event.summaryEn}
              >
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
      ))}

      <Button
        testID="record-service"
        label={t('logbook.addRecord')}
        variant={events.length === 0 ? 'primary' : 'secondary'}
        onPress={() => router.push({ pathname: '/record-service', params: { id } })}
      />

      <Button
        testID="open-mileage"
        label={t('logbook.mileageAction')}
        variant="secondary"
        onPress={() => router.push({ pathname: '/mileage', params: { id } })}
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
                  {`${reportBaseUrl()}/${reportToken}`}
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
