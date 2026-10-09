/**
 * «سجل السيارة» on a live job (0108).
 *
 * What was done to this car before, when, at what mileage, and who vouches for
 * it — the question every mechanic asks the owner and the owner rarely
 * remembers. The answer comes from the sealed logbook, so «نفّذتها هبّة» means
 * a Habba job with photos and a reading behind it, not a recollection.
 *
 * Summaries only (no photos, no addresses, nobody's name), and only while the
 * job is live: the server refuses it before acceptance and after hand-back.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, ProvenanceBadge, Row, Text, useTheme } from '@habba/ui';
import type { JobVehicleHistory } from '@/features/provider/data/provider-repository';
import { formatGregorianDate } from '@/features/shared/lib/dates';
import { formatCount } from '@/features/shared/lib/format-number';

const PROVENANCE_LABEL_KEY = {
  habba_verified: 'logbook.verifiedBadge',
  self_reported: 'logbook.selfReportedBadge',
  self_documented: 'logbook.selfDocumentedBadge',
  third_party: 'logbook.thirdPartyBadge',
} as const;

/** Enough to answer "when was the oil last changed" without scrolling past the job. */
const FOLDED = 3;

export function JobVehicleHistoryCard({ history }: { readonly history: JobVehicleHistory }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const isArabic = i18n.language.startsWith('ar');
  const shown = open ? history.events : history.events.slice(0, FOLDED);

  return (
    <Card testID="job-history" style={{ gap: theme.spacing.md }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Row gap="sm">
          <Icon
            name={history.isValid ? 'check' : 'alert'}
            size={theme.iconSize.sm}
            color={history.isValid ? theme.colors.successFg : theme.colors.warningFg}
          />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('jobHistory.title')}
          </Text>
        </Row>
        <Text variant="caption" tone="muted">
          {history.isValid ? t('jobHistory.sealed') : t('jobHistory.unsealed')}
          {history.currentMileage !== null
            ? ` · ${t('jobHistory.mileage', { km: formatCount(history.currentMileage, i18n.language) })}`
            : ''}
        </Text>
        {history.odometerReset ? (
          <Text variant="caption" tone="warning" testID="job-history-odometer">
            {t('jobHistory.odometerReset')}
          </Text>
        ) : null}
      </View>

      {history.events.length === 0 ? (
        <Text variant="bodySmall" tone="subtle" testID="job-history-empty">
          {t('jobHistory.empty')}
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {shown.map((event, index) => (
            <View
              key={`${event.occurredAt}-${index}`}
              style={{
                gap: 4,
                paddingTop: index === 0 ? 0 : theme.spacing.sm,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <Row gap="sm" justify="space-between">
                <Text variant="bodySmall" style={{ flex: 1 }}>
                  {isArabic ? event.summaryAr : event.summaryEn}
                </Text>
                <ProvenanceBadge
                  provenance={event.provenance}
                  label={t(PROVENANCE_LABEL_KEY[event.provenance])}
                />
              </Row>
              <Text variant="caption" tone="subtle">
                {formatGregorianDate(event.occurredAt, i18n.language)}
                {event.mileage !== null
                  ? ` · ${t('jobHistory.mileage', { km: formatCount(event.mileage, i18n.language) })}`
                  : ''}
              </Text>
            </View>
          ))}
          {history.events.length > FOLDED ? (
            <Pressable
              testID="job-history-toggle"
              accessibilityRole="button"
              onPress={() => setOpen((now) => !now)}
              hitSlop={8}
            >
              <Text variant="label" tone="primary">
                {open
                  ? t('jobHistory.less')
                  : t('jobHistory.more', {
                      n: formatCount(history.events.length - FOLDED, i18n.language),
                    })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Card>
  );
}
