/**
 * The logbook as a timeline rather than a stack of cards.
 *
 * §9.1 calls this the app's soul and asks for it chronological. The previous
 * screen was chronological in the weak sense — the events were in order — but
 * nothing on screen said so: eight identical cards with a date buried in the
 * third line of each. A rail and a month heading do the work that ordering
 * alone cannot, which is to make the *shape* of a car's history visible: long
 * gaps, clusters, the month everything went wrong.
 *
 * The dot carries provenance (ADR-0005) so the difference between a signed
 * service record and an owner's recollection is legible before any text is
 * read. That distinction is the moat; it should not need a badge to be seen,
 * though it keeps the badge too.
 *
 * `TimelineList` in @habba/ui is deliberately not reused: its states are
 * done/current/pending, which is a job's progress. Forcing a completed service
 * from 2024 into "done" and a mileage note into "pending" would put a
 * dispatch's semantics onto a history.
 */

import { Fragment } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, ProvenanceBadge, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { formatCount } from '@/features/shared/lib/format-number';
import {
  formatGregorianDate,
  formatHijriDate,
  formatMonthLabel,
  monthKey,
} from '@/features/shared/lib/dates';
import type { Provenance, TimelineEvent } from '@/features/shared/data/types';

const PROVENANCE_LABEL_KEY: Readonly<Record<Provenance, string>> = {
  habba_verified: 'logbook.verifiedBadge',
  self_reported: 'logbook.selfReportedBadge',
  self_documented: 'logbook.selfDocumentedBadge',
  third_party: 'logbook.thirdPartyBadge',
};

/** Later than this after the fact and the entry is a recollection (ADR-0012). */
const RECORDED_LATER_MS = 60 * 60 * 1000;

export interface LogbookTimelineProps {
  readonly events: readonly TimelineEvent[];
  readonly testID?: string | undefined;
}

export function LogbookTimeline({ events, testID }: LogbookTimelineProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');

  const dotColor = (provenance: Provenance) =>
    provenance === 'habba_verified' ? theme.colors.verified : theme.colors.selfReported;

  let lastMonth: string | null = null;

  return (
    <View testID={testID}>
      {events.map((event, index) => {
        const month = monthKey(event.occurredAt);
        const startsMonth = month !== lastMonth;
        lastMonth = month;

        const isLast = index === events.length - 1;
        const hijri = formatHijriDate(event.occurredAt, i18n.language);
        const recordedLater =
          new Date(event.recordedAt).getTime() - new Date(event.occurredAt).getTime() >
          RECORDED_LATER_MS;

        return (
          <Fragment key={event.id}>
            {startsMonth ? (
              <Text
                variant="label"
                tone="subtle"
                style={{
                  marginTop: index === 0 ? 0 : theme.spacing.lg,
                  marginBottom: theme.spacing.sm,
                }}
              >
                {formatMonthLabel(event.occurredAt, i18n.language)}
              </Text>
            ) : null}

            <View
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                gap: theme.spacing.md,
              }}
            >
              {/* The rail. Drawn per row rather than as one absolute line so
                  rows can be any height — an entry with a mileage reading and
                  a late-record note is taller than a bare one. */}
              <View style={{ width: 14, alignItems: 'center' }}>
                <View
                  style={{
                    width: 12,
                    height: 12,
                    marginTop: 6,
                    borderRadius: theme.radius.full,
                    backgroundColor: dotColor(event.provenance),
                  }}
                />
                {!isLast ? (
                  <View
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: theme.spacing.md,
                      backgroundColor: theme.colors.border,
                    }}
                  />
                ) : null}
              </View>

              <Card
                testID={`event-${event.id}`}
                elevation="none"
                style={{
                  flex: 1,
                  marginBottom: isLast ? 0 : theme.spacing.md,
                  gap: theme.spacing.sm,
                  borderColor: theme.colors.border,
                  borderWidth: 1,
                }}
              >
                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'flex-start',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {isArabic ? event.summaryAr : event.summaryEn}
                  </Text>
                  <ProvenanceBadge
                    provenance={event.provenance}
                    label={t(PROVENANCE_LABEL_KEY[event.provenance])}
                  />
                </View>

                <View style={{ gap: 2 }}>
                  <Text variant="caption" tone="muted">
                    {formatGregorianDate(event.occurredAt, i18n.language)}
                    {event.mileage !== null
                      ? ` · ${t('logbook.mileageAt', {
                          mileage: formatCount(event.mileage, i18n.language),
                        })}`
                      : ''}
                  </Text>

                  {/* §5: Hijri alongside Gregorian, never instead of it. Absent
                      when the platform has no Islamic calendar to format with. */}
                  {hijri !== null ? (
                    <Text variant="caption" tone="subtle">
                      {hijri}
                    </Text>
                  ) : null}

                  {/* ADR-0012: an entry written well after the fact is a
                      recollection, and saying so is what keeps the rest of the
                      logbook believable. */}
                  {recordedLater ? (
                    <Text variant="caption" tone="subtle">
                      {t('logbook.recordedLater')}
                    </Text>
                  ) : null}
                </View>
              </Card>
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}
