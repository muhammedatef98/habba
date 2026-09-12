/**
 * القادم — the forward half of the vehicle screen.
 *
 * It sits above حصل (the logbook) on the SAME screen rather than on one of its
 * own, and that is a product decision rather than a layout one: what a car
 * needs next is only meaningful next to what has already been done to it, and
 * a separate screen would have been a second history surface with a second
 * source of truth — the thing ADR-0022 refuses.
 *
 * Every sentence here comes from `lib/care-language.ts`, and this component may
 * not compose one of its own. The rule that module enforces is that a
 * distance-based item is never stated as a fact, because the app cannot see the
 * odometer between readings; a screen that wrote its own copy would honour that
 * on the day it was written and stop honouring it on the first edit.
 *
 * Three actions per item, and they are the three things a person actually does
 * when told a service is due: it is already done, not now, or book it.
 */

import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Row, StatusPill, Text, useTheme } from '@habba/ui';
import {
  byUrgency,
  documentLine,
  isSnoozed,
  maintenanceLine,
  type CareLine,
  type CareUrgency,
} from '@/features/shared/lib/care-language';
import { formatGregorianDate } from '@/features/shared/lib/dates';
import { formatCount } from '@/features/shared/lib/format-number';
import type { MaintenanceItem, VehicleDocument } from '@/features/shared/data/types';

export interface UpcomingCareProps {
  readonly items: readonly MaintenanceItem[];
  readonly documents: readonly VehicleDocument[];
  readonly onDone: (itemId: string) => void;
  readonly onSnooze: (itemId: string) => void;
  readonly onBook: (item: MaintenanceItem) => void;
  readonly onConfirmOdometer: () => void;
  readonly busyItemId?: string | null | undefined;
  readonly testID?: string | undefined;
}

/**
 * §8 reserves red for genuine emergencies, and an oil change is not one.
 * Overdue is `active`, not `emergency` — a section that shouts is a section
 * people learn to scroll past.
 */
const PILL_TONE: Readonly<Record<CareUrgency, 'neutral' | 'success' | 'active'>> = {
  overdue: 'active',
  soon: 'neutral',
  scheduled: 'neutral',
  unknown: 'neutral',
};

/**
 * Numbers go through `formatCount` before interpolation, not after: §8 pins
 * Latin digits, and a raw `{{km}}` would render in whatever numbering system
 * the locale happens to default to.
 */
function lineValues(line: CareLine, language: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(line.values).map(([key, value]) => [key, formatCount(value, language)]),
  );
}

export function UpcomingCare({
  items,
  documents,
  onDone,
  onSnooze,
  onBook,
  onConfirmOdometer,
  busyItemId,
  testID,
}: UpcomingCareProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isArabic = i18n.language.startsWith('ar');

  if (items.length === 0 && documents.length === 0) {
    return (
      <Card
        elevation="none"
        style={{ backgroundColor: theme.colors.surfaceSunken }}
        testID={testID ?? 'care-empty'}
      >
        <Text variant="body" tone="muted">
          {t('care.empty')}
        </Text>
      </Card>
    );
  }

  const rows = items
    .map((item) => ({ item, line: maintenanceLine(item) }))
    .sort((a, b) => byUrgency(a.line, b.line));

  const documentRows = documents
    .map((document) => ({ document, line: documentLine(document) }))
    .sort((a, b) => byUrgency(a.line, b.line));

  // Shown once, under the list, rather than appended to every estimated line.
  // Repeating the caveat per row turns it into wallpaper; saying it once with
  // the action attached is what makes it a thing anybody does.
  const hasEstimate = rows.some(({ line }) => !line.certain);

  return (
    <View testID={testID} style={{ gap: theme.spacing.md }}>
      {rows.length > 0 ? (
        <Card elevation="sm" style={{ gap: theme.spacing.md }}>
          {rows.map(({ item, line }) => {
            const snoozed = isSnoozed(item);
            return (
              <View
                key={item.itemId}
                testID={`care-item-${item.itemType}`}
                style={{ gap: theme.spacing.sm }}
              >
                <Row gap="sm" align="center" justify="space-between">
                  <Text variant="bodyStrong">{isArabic ? item.nameAr : item.nameEn}</Text>
                  <StatusPill
                    testID={`care-state-${item.itemType}`}
                    label={t(line.key, lineValues(line, i18n.language))}
                    tone={PILL_TONE[line.urgency]}
                    showDot={line.urgency === 'overdue'}
                  />
                </Row>

                {snoozed && item.snoozedUntil !== null ? (
                  <Text variant="caption" tone="subtle">
                    {t('care.snoozedUntil', {
                      date: formatGregorianDate(item.snoozedUntil, i18n.language),
                    })}
                  </Text>
                ) : null}

                {/* Wrapping, not a fixed three-across: «ذكّرني لاحقاً» is long
                    in Arabic and would otherwise clip on a small phone. */}
                <Row gap="sm" wrap>
                  <Button
                    testID={`care-done-${item.itemType}`}
                    label={t('care.done')}
                    variant="secondary"
                    size="medium"
                    fullWidth={false}
                    onPress={() => onDone(item.itemId)}
                    loading={busyItemId === item.itemId}
                  />
                  <Button
                    testID={`care-snooze-${item.itemType}`}
                    label={t('care.snooze')}
                    variant="ghost"
                    size="medium"
                    fullWidth={false}
                    onPress={() => onSnooze(item.itemId)}
                    disabled={snoozed}
                  />
                  {item.serviceId !== null ? (
                    <Button
                      testID={`care-book-${item.itemType}`}
                      label={t('care.book')}
                      variant="primary"
                      size="medium"
                      fullWidth={false}
                      onPress={() => onBook(item)}
                    />
                  ) : null}
                </Row>
              </View>
            );
          })}
        </Card>
      ) : null}

      {hasEstimate ? (
        <Card elevation="none" style={{ gap: theme.spacing.sm }}>
          <Row gap="sm" align="center">
            <Icon name="gauge" size={theme.iconSize.sm} color={theme.colors.textMuted} />
            <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>
              {t('care.estimateNote')}
            </Text>
          </Row>
          <Button
            testID="care-confirm-odometer"
            label={t('care.updateReading')}
            variant="secondary"
            size="medium"
            fullWidth={false}
            onPress={onConfirmOdometer}
          />
        </Card>
      ) : null}

      {documentRows.length > 0 ? (
        <Card elevation="none" style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('care.doc.title')}
          </Text>
          {documentRows.map(({ document, line }) => (
            <Row
              key={document.documentId}
              testID={`care-doc-${document.docType}`}
              gap="sm"
              align="center"
              justify="space-between"
            >
              <Text variant="bodySmall">{t(`care.doc.${document.docType}`)}</Text>
              {/* No hedge and no «متوقع»: an expiry date was read off a
                  document, so the only arithmetic is a subtraction. The
                  contrast with the estimated rows above is deliberate. */}
              <Text variant="caption" tone={line.urgency === 'overdue' ? 'warning' : 'subtle'}>
                {t(line.key, lineValues(line, i18n.language))}
              </Text>
            </Row>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
