/**
 * A single logbook entry, in full.
 *
 * The list shows what happened; this shows what is on record — the structured
 * details (oil grade, part numbers, cost), the attachments, and the two dates
 * that are easy to conflate: when the work happened and when it was recorded.
 *
 * It reads the same query the list does rather than fetching one row: the
 * timeline for one vehicle is small, it is already cached, and a logbook that
 * opens instantly offline is worth more than a marginally smaller request
 * (§2.7 — a basement parking garage is a normal place to read this).
 *
 * Nothing here is editable. The timeline is append-only (§2.4), and offering an
 * edit affordance that the server will refuse would be a lie about the product.
 */

import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Card,
  EmptyState,
  ListRow,
  ProvenanceBadge,
  Screen,
  Text,
  Button,
  useTheme,
} from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import type { Provenance } from '@/features/shared/data/types';
import { useIsAuthenticated } from '@/features/shared/state/session';

const PROVENANCE_LABEL_KEY: Record<Provenance, string> = {
  habba_verified: 'logbook.verifiedBadge',
  self_reported: 'logbook.selfReportedBadge',
  self_documented: 'logbook.selfDocumentedBadge',
  third_party: 'logbook.thirdPartyBadge',
};

const PROVENANCE_EXPLANATION_KEY: Record<Provenance, string> = {
  habba_verified: 'logbook.detail.provenanceVerified',
  self_reported: 'logbook.detail.provenanceSelfReported',
  self_documented: 'logbook.detail.provenanceSelfDocumented',
  third_party: 'logbook.detail.provenanceThirdParty',
};

/** Keys the app knows how to label. Anything else is shown as it was stored. */
const DETAIL_LABEL_KEY: Record<string, string> = {
  service_type: 'logbook.detail.serviceType',
  cost_sar: 'logbook.detail.cost',
  parts: 'logbook.detail.parts',
  oil_grade: 'logbook.detail.oilGrade',
  part_number: 'logbook.detail.partNumber',
  workshop: 'logbook.detail.workshop',
};

function renderValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        entry !== null && typeof entry === 'object'
          ? Object.values(entry as Record<string, unknown>)
              .filter(Boolean)
              .join(' · ')
          : String(entry),
      )
      .join('، ');
  }
  return JSON.stringify(value);
}

export default function EventScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId: string }>();
  const isArabic = i18n.language === 'ar';

  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => repository.listTimeline(id ?? ''),
    enabled: id !== undefined,
  });

  if (!isAuthenticated) return <Redirect href="/" />;

  const event = (timeline.data ?? []).find((candidate) => candidate.id === eventId);

  if (timeline.isPending) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {t('common.loading')}
        </Text>
      </Screen>
    );
  }

  if (event === undefined) {
    return (
      <Screen>
        <EmptyState
          testID="event-missing"
          title={t('logbook.detail.missingTitle')}
          body={t('logbook.detail.missingBody')}
          actionLabel={t('common.back')}
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const occurred = new Date(event.occurredAt);
  const recorded = new Date(event.recordedAt);
  const locale = isArabic ? 'ar-SA' : 'en-GB';
  const detailEntries = Object.entries(event.details);

  return (
    <Screen scrollable>
      <ProvenanceBadge
        provenance={event.provenance}
        label={t(PROVENANCE_LABEL_KEY[event.provenance])}
      />

      <Text variant="title">{isArabic ? event.summaryAr : event.summaryEn}</Text>

      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <View style={{ gap: theme.spacing.sm }}>
          <ListRow
            title={t('logbook.detail.occurredAt')}
            value={occurred.toLocaleDateString(locale)}
          />
          {/* Both dates, always. "Recorded three years later" is exactly the
              context a buyer needs to weigh an entry (ADR-0012). */}
          <ListRow
            title={t('logbook.detail.recordedAt')}
            value={recorded.toLocaleDateString(locale)}
          />
          {event.mileage !== null ? (
            <ListRow
              title={t('logbook.detail.mileage')}
              value={t('logbook.mileageAt', { mileage: event.mileage })}
            />
          ) : null}
        </View>
      </Card>

      {detailEntries.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t('logbook.detail.recordTitle')}</Text>
          {detailEntries.map(([key, value]) => (
            <ListRow
              key={key}
              testID={`detail-${key}`}
              title={DETAIL_LABEL_KEY[key] === undefined ? key : t(DETAIL_LABEL_KEY[key] as string)}
              value={renderValue(value)}
            />
          ))}
        </View>
      ) : null}

      {event.attachments.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t('logbook.detail.attachments')}</Text>
          {event.attachments.map((attachment) => (
            <ListRow
              key={attachment.url}
              testID={`attachment-${attachment.kind}`}
              title={
                attachment.caption ?? t('logbook.detail.attachmentKind', { kind: attachment.kind })
              }
              subtitle={attachment.url}
            />
          ))}
        </View>
      ) : null}

      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="bodyStrong">{t('logbook.detail.provenanceTitle')}</Text>
          <Text variant="caption" tone="muted">
            {t(PROVENANCE_EXPLANATION_KEY[event.provenance])}
          </Text>
          {/* Said plainly, on the screen where someone might otherwise look for
              an edit button. */}
          <Text variant="caption" tone="subtle">
            {t('logbook.detail.appendOnlyNote')}
          </Text>
        </View>
      </Card>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
