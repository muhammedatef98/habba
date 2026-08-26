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

import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
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

export default function LogbookScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isArabic = i18n.language === 'ar';

  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => repository.listTimeline(id ?? ''),
    enabled: id !== undefined,
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

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
