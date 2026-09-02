/**
 * دفتر السيارة — the logbook.
 *
 * §9.1: "This is the app's soul — design it first, not last." It was designed
 * last, and it showed: a title that never said which car, a flat stack of
 * identical cards, and the verified-versus-owner-entered ratio — the number the
 * entire moat rests on — rendered as a 12px grey caption between two headings.
 *
 * The three things this screen now does that it did not:
 *
 *  1. Names the car. With two vehicles in a household, "دفتر السيارة" alone is
 *     a screen you cannot be sure you are reading correctly.
 *  2. Leads with coverage. §1.2 says a documented car sells for more, and what
 *     a buyer pays for is the *verified* share. The gap between the two bars is
 *     the argument for routing the next service through Habba, so it is shown
 *     as a proportion rather than as a sentence.
 *  3. Filters, which §9.1 asked for and nothing implemented. The cuts are the
 *     questions people arrive with — when was it serviced, has it been
 *     inspected, what has the odometer done — not the schema's nine event
 *     types.
 *
 * تقرير هبّة lives inside the coverage card rather than as a loose amber button
 * halfway down, because generating it is the thing you do *because of* the
 * coverage number, not a separate errand.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Screen, Text, useTheme } from '@habba/ui';
import { CoverageBar } from '@/components/logbook/CoverageBar';
import { LogbookTimeline } from '@/components/logbook/LogbookTimeline';
import { SectionHeader } from '@/components/home/SectionHeader';
import { repository } from '@/data/repository';
import { formatCount } from '@/lib/format-number';
import {
  countByFilter,
  filterEvents,
  LOGBOOK_FILTERS,
  type LogbookFilter,
} from '@/lib/logbook-filter';
import { describeVehicleModel, vehicleLabel } from '@/lib/vehicle-label';
import { useIsAuthenticated } from '@/state/session';

/** Where the public report is served. Replaced by the real domain at launch. */
const REPORT_BASE_URL = 'https://habba.sa/r';

const FILTER_LABEL_KEY: Readonly<Record<LogbookFilter, string>> = {
  all: 'logbook.filterAll',
  service: 'logbook.filterService',
  inspection: 'logbook.filterInspection',
  mileage: 'logbook.filterMileage',
};

export default function LogbookScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isArabic = i18n.language.startsWith('ar');

  const [reportToken, setReportToken] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogbookFilter>('all');

  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => repository.listTimeline(id ?? ''),
    enabled: id !== undefined,
  });

  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => repository.getVehicle(id ?? ''),
    enabled: id !== undefined,
  });

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const models = useQuery({
    queryKey: ['models', 'all'],
    queryFn: async () => {
      const makeList = await repository.listMakes();
      const lists = await Promise.all(makeList.map((make) => repository.listModels(make.id)));
      return lists.flat();
    },
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

  const counts = countByFilter(events);
  const shown = filterEvents(events, filter);

  const sources = { makes: makes.data, models: models.data, isArabic };
  const car = vehicle.data;
  const described = car === null || car === undefined ? '' : describeVehicleModel(car, sources);
  const heading =
    car === null || car === undefined
      ? t('logbook.vehicleUnknown')
      : (car.nickname?.trim().length ?? 0) > 0
        ? (car.nickname as string)
        : described.length > 0
          ? described
          : vehicleLabel(car, sources);

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="label" tone="muted">
          {t('logbook.title')}
        </Text>
        <Text variant="title">{heading}</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
          {car?.plateNormalised != null ? (
            <Text variant="bodySmall" tone="muted" numeric>
              {car.plateNormalised}
            </Text>
          ) : null}
          {events.length > 0 ? (
            <Text variant="bodySmall" tone="subtle">
              {t('logbook.recordsCount', { count: formatCount(events.length, i18n.language) })}
            </Text>
          ) : null}
        </View>
      </View>

      {events.length === 0 ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">{t('logbook.emptyTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('logbook.emptyBody')}
            </Text>
            <Button
              testID="record-service"
              label={t('logbook.addRecord')}
              onPress={() => router.push({ pathname: '/record-service', params: { id } })}
            />
          </View>
        </Card>
      ) : (
        <>
          <Card testID="logbook-coverage" elevation="sm" style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="subheading">{t('logbook.coverageTitle')}</Text>
              <Text variant="caption" tone="muted">
                {t('logbook.coverageBody')}
              </Text>
            </View>

            <CoverageBar
              testID="logbook-coverage-bar"
              verified={verifiedCount}
              selfReported={selfReportedCount}
            />

            <Button
              testID="generate-report"
              label={t('logbook.generateReport')}
              variant="accent"
              size="medium"
              onPress={() => report.mutate()}
              loading={report.isPending}
            />

            {reportToken !== null ? (
              <View
                style={{
                  gap: theme.spacing.xs,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  paddingTop: theme.spacing.md,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Icon name="check" size={theme.iconSize.sm} color={theme.colors.successFg} />
                  <Text variant="bodyStrong" tone="success">
                    {t('logbook.reportReady')}
                  </Text>
                </View>
                <Text variant="caption" tone="muted">
                  {t('logbook.reportShareHint')}
                </Text>
                <Text variant="caption" tone="primary" selectable>
                  {`${REPORT_BASE_URL}/${reportToken}`}
                </Text>
                <Text variant="caption" tone="subtle">
                  {t('logbook.reportCoverage', {
                    verified: formatCount(verifiedCount, i18n.language),
                    total: formatCount(events.length, i18n.language),
                  })}
                </Text>
              </View>
            ) : null}

            {reportError !== null ? (
              <Text variant="caption" tone="emergency">
                {reportError}
              </Text>
            ) : null}
          </Card>

          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader
              title={t('logbook.title')}
              actionLabel={t('logbook.addRecord')}
              onAction={() => router.push({ pathname: '/record-service', params: { id } })}
            />

            {/* A filter with nothing behind it is a control that punishes
                curiosity, so an empty bucket is not offered. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {LOGBOOK_FILTERS.filter((option) => counts[option] > 0).map((option) => {
                const selected = filter === option;
                return (
                  <Card
                    key={option}
                    testID={`logbook-filter-${option}`}
                    elevation="none"
                    onPress={() => setFilter(option)}
                    style={{
                      paddingVertical: theme.spacing.xs,
                      paddingHorizontal: theme.spacing.md,
                      minHeight: 36,
                      justifyContent: 'center',
                      borderRadius: theme.radius.full,
                      backgroundColor: selected
                        ? theme.colors.primarySubtle
                        : theme.colors.surfaceSunken,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderWidth: selected ? 1.5 : 1,
                    }}
                  >
                    <Text variant="caption" tone={selected ? 'primary' : 'muted'}>
                      {`${t(FILTER_LABEL_KEY[option])} · ${formatCount(counts[option], i18n.language)}`}
                    </Text>
                  </Card>
                );
              })}
            </View>

            {shown.length === 0 ? (
              <Text variant="bodySmall" tone="muted">
                {t('logbook.filterEmpty')}
              </Text>
            ) : (
              <LogbookTimeline testID="logbook-timeline" events={shown} />
            )}
          </View>
        </>
      )}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
