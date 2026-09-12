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
 *
 * Since 0058–0062 the screen has two sections rather than one: **القادم** (what
 * the car needs next) above **حصل** (what has happened to it). One screen, not
 * two, and حصل is this same timeline rather than a new history surface —
 * ADR-0022. The forward half is only meaningful next to the record behind it:
 * "the oil is likely due" means something different on a car whose last three
 * services are in the logbook than on one whose owner typed a number once.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  ErrorState,
  Icon,
  Screen,
  SkeletonCard,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { CoverageBar } from '@/features/customer/components/logbook/CoverageBar';
import { UpcomingCare } from '@/features/customer/components/logbook/UpcomingCare';
import { LogbookTimeline } from '@/features/customer/components/logbook/LogbookTimeline';
import { SectionHeader } from '@/features/customer/components/home/SectionHeader';
import { repository } from '@/features/shared/data/repository';
import { shareHabbaReportPdf } from '@/features/shared/lib/report-pdf';
import { formatCount } from '@/features/shared/lib/format-number';
import {
  countByFilter,
  filterEvents,
  LOGBOOK_FILTERS,
  type LogbookFilter,
} from '@/features/shared/lib/logbook-filter';
import { describeVehicleModel, vehicleLabel } from '@/features/shared/lib/vehicle-label';
import { useBookingDraft } from '@/features/shared/state/booking-draft';
import { useIsAuthenticated } from '@/features/shared/state/session';
import type { MaintenanceItem } from '@/features/shared/data/types';

/**
 * «ذكّرني لاحقاً» defers by a fortnight, matching `care_default_snooze_days()`
 * (0062). Not offered as a picker: a screen that asks "for how long?" turns a
 * dismissal into a decision, and the point of the button is to let someone get
 * on with their day.
 */
const CARE_SNOOZE_DAYS = 14;

const FILTER_LABEL_KEY: Readonly<Record<LogbookFilter, string>> = {
  all: 'logbook.filterAll',
  service: 'logbook.filterService',
  inspection: 'logbook.filterInspection',
  mileage: 'logbook.filterMileage',
};

export default function LogbookScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useIsAuthenticated();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isArabic = i18n.language.startsWith('ar');

  const [reportShared, setReportShared] = useState(false);
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

  const warranties = useQuery({
    queryKey: ['warranties', id],
    queryFn: () => repository.listVehicleWarranties(id ?? ''),
    enabled: id !== undefined,
  });

  const care = useQuery({
    queryKey: ['care', id],
    queryFn: () => repository.listMaintenanceItems(id ?? ''),
    enabled: id !== undefined,
  });

  const documents = useQuery({
    queryKey: ['care-documents', id],
    queryFn: () => repository.listVehicleDocuments(id ?? ''),
    enabled: id !== undefined,
  });

  // «تم» and «ذكّرني لاحقاً» both change what القادم says, so both refetch it.
  // Optimism here would be the wrong trade: the due state is computed from the
  // odometer server-side, and a screen that guessed it would occasionally show
  // an item as settled that the next sweep still reminds about.
  const actOnItem = useMutation({
    mutationFn: async (action: { itemId: string; kind: 'done' | 'snooze' }) => {
      if (action.kind === 'done') {
        await repository.markMaintenanceItemDone(action.itemId);
        return;
      }
      await repository.snoozeMaintenanceItem(action.itemId, CARE_SNOOZE_DAYS);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['care', id] });
      // «تم» writes a reading, which is a logbook entry.
      await queryClient.invalidateQueries({ queryKey: ['timeline', id] });
    },
  });

  /**
   * «احجز الآن» — §7.2's one-tap booking with the right service pre-selected.
   *
   * The catalogue is fetched HERE rather than on mount: it is needed only if
   * the button is pressed, and the vehicle screen should not pay for a service
   * list most visits never look at. `fetchQuery` shares the cache entry the
   * booking screen itself uses, so the trip is usually free anyway.
   *
   * A service that is no longer bookable still navigates, with the car chosen.
   * Refusing to move would leave the owner staring at a button that does
   * nothing; the booking screen can say what is available far better than this
   * one can.
   */
  const startBooking = useMutation({
    mutationFn: async (item: MaintenanceItem) => {
      const draft = useBookingDraft.getState();
      if (id !== undefined) draft.selectVehicle(id);
      if (item.serviceId === null) return;

      const services = await queryClient.fetchQuery({
        queryKey: ['bookable-services'],
        queryFn: () => repository.listBookableServices(),
      });
      const service = services.find((candidate) => candidate.id === item.serviceId);
      if (service !== undefined) draft.selectService(service);
    },
    onSettled: () => router.push('/booking'),
  });

  const makes = useQuery({ queryKey: ['makes'], queryFn: () => repository.listMakes() });
  const models = useQuery({
    queryKey: ['models', 'all'],
    queryFn: () => repository.listAllModels(),
  });

  // Issue, read back, render, share — one action from the owner's side, and
  // the whole of ADR-0019 from ours. The payload is read back by token rather
  // than rebuilt from the timeline: the PDF must say what the database froze,
  // or the document and the record it claims to be are different things.
  const report = useMutation({
    mutationFn: async () => {
      const token = await repository.generateReport(id ?? '');
      const payload = await repository.getReport(token);
      if (payload === null) throw new Error('report_missing');
      return shareHabbaReportPdf(payload);
    },
    onSuccess: (result) => {
      setReportShared(result.ok);
      setReportError(result.ok ? null : t('logbook.errors.reportShareUnavailable'));
    },
    onError: (error: Error) => {
      setReportShared(false);
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
        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            gap: theme.spacing.sm,
            alignItems: 'center',
          }}
        >
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

      {/* القادم, above حصل and OUTSIDE the timeline's loading branches: what
          the car needs next does not depend on the logbook having loaded, and
          a dropped timeline fetch must not take the section that can book a
          service down with it. */}
      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('care.title')} />
        {care.isPending || documents.isPending ? (
          <SkeletonCard testID="care-skeleton" lines={2} />
        ) : care.isError || documents.isError ? (
          <ErrorState
            testID="care-error"
            message={t('errors.offline')}
            retryLabel={t('common.retry')}
            retrying={care.isFetching || documents.isFetching}
            onRetry={() => {
              void care.refetch();
              void documents.refetch();
            }}
          />
        ) : (
          <UpcomingCare
            testID="care-section"
            items={care.data ?? []}
            documents={documents.data ?? []}
            busyItemId={actOnItem.isPending ? (actOnItem.variables?.itemId ?? null) : null}
            onDone={(itemId) => actOnItem.mutate({ itemId, kind: 'done' })}
            onSnooze={(itemId) => actOnItem.mutate({ itemId, kind: 'snooze' })}
            onBook={(item) => startBooking.mutate(item)}
            onConfirmOdometer={() => router.push({ pathname: '/mileage', params: { id } })}
          />
        )}
      </View>

      {/* The one screen the product cannot afford to be wrong about. Telling
          an owner with two years of history that their logbook "starts here"
          undermines the single thing §1 asks them to trust — and it would be a
          dropped connection saying it, not the record. */}
      {timeline.isError ? (
        <ErrorState
          testID="logbook-error"
          message={t('errors.offline')}
          retryLabel={t('common.retry')}
          retrying={timeline.isFetching}
          onRetry={() => void timeline.refetch()}
        />
      ) : timeline.isPending ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('common.loading')}
          style={{ gap: theme.spacing.md }}
        >
          <SkeletonCard testID="logbook-skeleton" lines={3} />
          <SkeletonCard lines={3} />
        </View>
      ) : events.length === 0 ? (
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

            {reportShared ? (
              <View
                style={{
                  gap: theme.spacing.xs,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.border,
                  paddingTop: theme.spacing.md,
                }}
              >
                <View
                  style={{
                    flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Icon name="check" size={theme.iconSize.sm} color={theme.colors.successFg} />
                  <Text variant="bodyStrong" tone="success">
                    {t('logbook.reportReady')}
                  </Text>
                </View>
                <Text variant="caption" tone="muted">
                  {t('logbook.reportShareHint')}
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
            {/* حصل. The same timeline, under the name the section has on the
                screen — not a second history surface (ADR-0022). */}
            <SectionHeader
              title={t('care.happened')}
              actionLabel={t('logbook.addRecord')}
              onAction={() => router.push({ pathname: '/record-service', params: { id } })}
            />

            {/* A filter with nothing behind it is a control that punishes
                curiosity, so an empty bucket is not offered. */}
            <View
              style={{
                flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                flexWrap: 'wrap',
                gap: theme.spacing.sm,
              }}
            >
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

          {/* Live cover, from `vehicle_warranties()` rather than from anything
              under `orders` (ADR-0021). After a handover the two differ: the
              buyer owns the cover and cannot read the order that carries it,
              and the report prints the car's cover, not the payer's. */}
          {warranties.data !== undefined && warranties.data.length > 0 ? (
            <View style={{ gap: theme.spacing.md }}>
              <SectionHeader title={t('transfer.warrantiesTitle')} />
              <Card elevation="none" style={{ gap: theme.spacing.md }}>
                <Text variant="caption" tone="muted">
                  {t('transfer.warrantiesBody')}
                </Text>
                {warranties.data.map((warranty) => (
                  <View key={warranty.orderId} style={{ gap: 2 }}>
                    <Text variant="bodySmall">
                      {isArabic ? warranty.serviceAr : warranty.serviceEn}
                    </Text>
                    <Text variant="caption" tone="subtle">
                      {t('transfer.warrantyRemaining', {
                        days: formatCount(warranty.daysRemaining, i18n.language),
                      })}
                      {warranty.hasOpenClaim ? ` · ${t('transfer.warrantyOpenClaim')}` : ''}
                    </Text>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}

          {/* «إدارة السيارة» sits at the FOOT of the logbook, not in the
              coverage card. Transferring is rare and irreversible; the card
              holds «أصدر تقرير هبّة», which is the button people press often.
              Putting them adjacent optimises for the wrong one. */}
          <View style={{ gap: theme.spacing.md }}>
            <SectionHeader title={t('transfer.manageSection')} />
            <Card elevation="none" style={{ gap: theme.spacing.sm }}>
              <Button
                testID="logbook-mileage"
                label={t('logbook.updateMileage')}
                variant="secondary"
                size="medium"
                onPress={() => router.push({ pathname: '/mileage', params: { id } })}
              />
              <Button
                testID="logbook-transfer"
                label={t('transfer.entry')}
                variant="ghost"
                size="medium"
                onPress={() => router.push({ pathname: '/transfer', params: { id } })}
              />
              <Text variant="caption" tone="subtle">
                {t('transfer.entryHint')}
              </Text>
            </Card>
          </View>
        </>
      )}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
