/**
 * A single job.
 *
 * The button offered is whatever `nextJobStep` says, which mirrors the server
 * state machine and is kept honest by a parity test. A technician tapping a
 * button that fails server-side is a technician who stops trusting the app,
 * and at the roadside that is expensive.
 *
 * Note there is no "complete" button. Only the customer confirms completion
 * (ADR-0006), and offering it here would be offering something the server
 * refuses.
 */

import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  canQuoteParts,
  canRecordEvidence,
  isEvidenceComplete,
  nextJobStep,
  toLatinDigits,
} from '@habba/core';
import { Button, Card, Field, Row, Screen, Text, useTheme } from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';
import { useLiveRefresh } from '@/features/shared/lib/live';
import { chatOpen } from '@/features/shared/lib/chat';
import { useFeatures, usePlatformStatus } from '@/features/shared/hooks/use-platform';
import { distanceLabel } from '@/features/provider/lib/distance-band';
import { JobVehicleHistoryCard } from '@/features/provider/components/JobVehicleHistoryCard';
import { navigationLinks } from '@/features/provider/lib/navigate';
import { loadDraft, syncEvidenceNow } from '@/features/provider/lib/evidence-queue';
import { formatAppointment } from '@/features/shared/lib/dates';
import { formatSarDisplay } from '@/features/shared/lib/money-format';
import { BackBar } from '@/features/shared/components/BackBar';

export default function JobScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => providerRepository.getJob(id ?? ''),
    enabled: id !== undefined,
  });

  /**
   * Declining is deliberately cheap and explicit.
   *
   * A provider who cannot decline in one tap will simply ignore the offer
   * instead, which looks identical to the dispatcher — the job sits pending,
   * the radius never widens, and the customer waits on somebody who already
   * decided no. An ignored offer is the expensive outcome, not a declined one.
   *
   * Only offered on jobs not yet accepted: there is nothing to decline once
   * the job is yours, and abandoning one is a cancellation with different
   * rules entirely.
   */
  const decline = useMutation({
    mutationFn: () => providerRepository.declineOffer(id ?? ''),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['open-jobs'] });
      router.replace('/');
    },
  });

  const [notice, setNotice] = useState<string | undefined>(undefined);
  const features = useFeatures();
  const handoverRequired = usePlatformStatus().handoverRequired;
  const [handoverInput, setHandoverInput] = useState('');
  const [handoverMessage, setHandoverMessage] = useState<string | null>(null);

  // The customer reads a four-digit code out at the car (0047); the
  // technician enters it here so the car is worked on only by the person
  // Habba sent. The code itself is never readable from this side.
  const atTheCar =
    job.data !== null &&
    job.data !== undefined &&
    job.data.offer === null &&
    job.data.status === 'arrived' &&
    job.data.fulfilmentMode !== 'workshop';
  const handover = useQuery({
    queryKey: ['handover', id],
    queryFn: () => providerRepository.getHandoverStatus(id ?? ''),
    enabled: atTheCar,
  });
  const verifyHandover = useMutation({
    mutationFn: (code: string) => providerRepository.verifyHandoverCode(id ?? '', code),
    meta: { inlineError: true },
    onSuccess: async (matched) => {
      setHandoverInput('');
      setHandoverMessage(matched ? null : t('handover.wrong'));
      await queryClient.invalidateQueries({ queryKey: ['handover', id] });
    },
    onError: async (cause) => {
      setHandoverMessage(
        cause instanceof Error && cause.message === 'handover:locked'
          ? t('handover.locked')
          : t('handover.failed'),
      );
      await queryClient.invalidateQueries({ queryKey: ['handover', id] });
    },
  });
  const handoverBlocks =
    atTheCar && handoverRequired && handover.data !== undefined && handover.data.issued
      ? !handover.data.verified
      : false;

  // The car's history while the job is live (0108). The server decides when
  // it opens and closes; this only avoids asking when it certainly would not.
  const historyOpen =
    features.jobHistory &&
    job.data !== null &&
    job.data !== undefined &&
    job.data.offer === null &&
    chatOpen(job.data.status);
  const history = useQuery({
    queryKey: ['job-history', id],
    queryFn: () => providerRepository.getJobHistory(id ?? ''),
    enabled: historyOpen,
    staleTime: 5 * 60 * 1000,
  });

  const quotable = job.data !== null && job.data !== undefined && canQuoteParts(job.data.status);
  const parts = useQuery({
    queryKey: ['job-parts', id],
    queryFn: () => providerRepository.listParts(id ?? ''),
    enabled: quotable,
    refetchInterval: quotable ? 5000 : false,
  });
  const waitingParts = (parts.data ?? []).filter((line) => line.answer === 'pending').length;

  const advance = useMutation({
    mutationFn: async (): Promise<'done' | 'taken'> => {
      const current = job.data;
      if (current === null || current === undefined) return 'done';

      const step = nextJobStep(current.status, current.fulfilmentMode);
      if (step.toStatus === null) return 'done';

      if (step.action === 'accept') {
        return (await providerRepository.acceptJob(current.orderId)) === 'accepted'
          ? 'done'
          : 'taken';
      }
      if (step.action === 'check_in_vehicle') {
        await providerRepository.checkInVehicle(current.orderId);
      } else {
        await providerRepository.advanceJob(current.orderId, step.toStatus);
      }
      return 'done';
    },
    onMutate: () => setNotice(undefined),
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
      await queryClient.invalidateQueries({ queryKey: ['open-jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['my-jobs'] });
      // Said plainly rather than as an error: several technicians are offered
      // every emergency and one wins. The offer is gone from their list too.
      if (outcome === 'taken') setNotice(t('job.lostRace'));
    },
    onError: () => setNotice(t('job.actionFailed')),
  });

  // The customer's answer to a quoted part, or a cancellation, lands at once.
  useLiveRefresh(
    [
      { table: 'orders', filter: `id=eq.${id ?? ''}` },
      { table: 'order_parts', filter: `order_id=eq.${id ?? ''}` },
    ],
    [
      ['job', id],
      ['job-parts', id],
    ],
    id !== undefined,
  );

  const data = job.data;

  // Where to drive (0099): only for a mobile job that is this technician's
  // and still live. The server answers null otherwise; asking only then
  // saves the request.
  const driving =
    data !== null &&
    data !== undefined &&
    data.offer === null &&
    data.fulfilmentMode !== 'workshop' &&
    ['accepted', 'en_route', 'arrived', 'in_progress'].includes(data.status);
  // Evidence saved on the phone and not yet sent (ADR-0012).
  const queued = useQuery({
    queryKey: ['evidence-draft', id],
    queryFn: () => loadDraft(id ?? ''),
    enabled: id !== undefined,
  });
  const sendNow = useMutation({
    mutationFn: () => syncEvidenceNow(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['evidence-draft', id] });
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
    },
  });

  const destination = useQuery({
    queryKey: ['job-destination', id],
    queryFn: () => providerRepository.getJobDestination(id ?? ''),
    enabled: driving,
    staleTime: Infinity,
  });

  if (data === null || data === undefined) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {job.isLoading ? t('common.loading') : t('errors.notFound')}
        </Text>
      </Screen>
    );
  }

  const step = nextJobStep(data.status, data.fulfilmentMode);

  const evidenceReady = isEvidenceComplete(
    {
      requiresMileage: data.requiresCompletionMileage,
      requiresPhotos: data.requiresCompletionPhotos,
    },
    data.completionMileage,
    data.completionMedia,
  );

  // The server refuses the hand-back without evidence. Blocking here means the
  // technician is told what is missing instead of being handed a database
  // error after tapping.
  const blockedForEvidence = step.action === 'submit_for_approval' && !evidenceReady;

  // Same rule as the server (0067): every quoted part answered first. Said
  // here, with the way out, instead of a refusal after the tap.
  const blockedForParts = step.action === 'submit_for_approval' && waitingParts > 0;

  // An inspection is handed back with its report, or not at all (0073).
  const needsInspection = data.inspectionTemplateKey !== null;
  const blockedForInspection =
    step.action === 'submit_for_approval' && needsInspection && !data.inspectionFiled;

  return (
    <Screen scrollable>
      <BackBar />
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{data.serviceNameAr}</Text>
        <Text variant="caption" tone="muted">
          {data.orderNumber.length > 0
            ? `${data.orderNumber} · ${t(`job.status.${data.status}`)}`
            : t(`job.status.${data.status}`)}
        </Text>
        {/* Free, and the technician's own earlier work (0105): said before
            anything else so the job is never quoted or treated as new. */}
        {data.isWarranty ? (
          <Card
            testID="job-warranty"
            elevation="none"
            style={{ backgroundColor: theme.colors.warningSubtle, gap: 2 }}
          >
            <Text variant="bodyStrong" tone="warning">
              {t('warranty.jobTitle')}
            </Text>
            <Text variant="caption" tone="muted">
              {t('warranty.jobBody')}
            </Text>
          </Card>
        ) : null}
        {data.scheduledFor !== null ? (
          <Text testID="job-scheduled" variant="bodyStrong">
            {t('provider.scheduledFor', {
              when: formatAppointment(data.scheduledFor, i18n.language),
            })}
          </Text>
        ) : null}
      </View>

      {historyOpen && history.data !== undefined ? (
        <JobVehicleHistoryCard history={history.data} />
      ) : null}

      {/* What a technician needs to decide on an offer: how far, and what it
          pays. The address arrives once they accept (ADR-0013). */}
      {data.offer !== null ? (
        <Card
          testID="job-offer"
          elevation="none"
          style={{ backgroundColor: theme.colors.surfaceSunken }}
        >
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodyStrong">
              {t('provider.distanceLabel')}: {distanceLabel(data.offer.distanceBucket, t)}
              {data.offer.districtNameAr !== null ? ` · ${data.offer.districtNameAr}` : ''}
            </Text>
            {data.offer.estimatedPayout !== null ? (
              <Text variant="body" numeric>
                {t('provider.payoutLabel')}: {formatSarDisplay(data.offer.estimatedPayout)}{' '}
                {t('provider.sarSuffix')}
              </Text>
            ) : null}
            {data.offer.hasTriageVideo ? (
              <Text variant="caption" tone="muted">
                {t('provider.hasVideo')}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}

      {queued.data?.submitRequested === true ? (
        <Card
          testID="evidence-queued-banner"
          elevation="none"
          style={{
            gap: theme.spacing.sm,
            backgroundColor: theme.colors.warningSubtle,
            borderColor: theme.colors.warningBorder,
            borderWidth: 1,
          }}
        >
          <Text variant="bodyStrong">{t('provider.evidenceQueuedTitle')}</Text>
          <Text variant="caption" tone="muted">
            {queued.data.lastError !== null
              ? t('provider.evidenceRefused')
              : t('provider.evidenceQueuedBody', {
                  count: queued.data.photos.filter((photo) => photo.uploaded === null).length,
                })}
          </Text>
          {queued.data.lastError === null ? (
            <Button
              testID="evidence-send-now"
              label={t('provider.evidenceSendNow')}
              variant="secondary"
              size="medium"
              onPress={() => sendNow.mutate()}
              loading={sendNow.isPending}
            />
          ) : null}
        </Card>
      ) : null}

      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          {/* Present only once assigned — before acceptance the server does
              not return it at all (ADR-0013). */}
          {data.addressAr === null ? (
            <Text variant="caption" tone="subtle">
              {t('provider.addressAfterAccept')}
            </Text>
          ) : (
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" tone="muted">
                {t('provider.address')}
              </Text>
              <Text variant="bodyStrong">{data.addressAr}</Text>
            </View>
          )}

          {driving && destination.data !== null && destination.data !== undefined ? (
            <Row gap="sm" testID="job-navigate">
              <View style={{ flex: 1 }}>
                <Button
                  testID="job-directions"
                  label={t('provider.directions')}
                  variant="primary"
                  size="medium"
                  onPress={() => {
                    const links = navigationLinks(destination.data!, Platform.OS);
                    void Linking.openURL(links.native).catch(() => Linking.openURL(links.web));
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  testID="job-waze"
                  label={t('provider.waze')}
                  variant="secondary"
                  size="medium"
                  onPress={() =>
                    void Linking.openURL(navigationLinks(destination.data!, Platform.OS).waze)
                  }
                />
              </View>
            </Row>
          ) : null}

          {/* The order's thread (0101) — the customer's number is never shown. */}
          {data.offer === null && features.orderChat && chatOpen(data.status) ? (
            <Button
              testID="job-chat"
              label={t('provider.messageCustomer')}
              variant="secondary"
              size="medium"
              onPress={() =>
                router.push({ pathname: '/chat', params: { id: id ?? '', side: 'provider' } })
              }
            />
          ) : null}

          {data.problemDescription !== null ? (
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="label" tone="muted">
                {t('provider.problem')}
              </Text>
              <Text variant="body">{data.problemDescription}</Text>
            </View>
          ) : null}
        </View>
      </Card>

      {quotable ? (
        <Card testID="job-parts" elevation="none">
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{t('provider.partsTitle')}</Text>
            <Text variant="caption" tone="muted">
              {(parts.data ?? []).length === 0
                ? t('provider.noParts')
                : waitingParts > 0
                  ? t('provider.partsWaiting', { count: waitingParts })
                  : t('provider.partsAllAnswered')}
            </Text>
            <Button
              testID="open-parts"
              label={t('provider.partsManage')}
              variant="secondary"
              onPress={() => router.push({ pathname: '/parts', params: { id: data.orderId } })}
            />
          </View>
        </Card>
      ) : null}

      {needsInspection && (data.status === 'in_progress' || data.inspectionFiled) ? (
        <Card testID="job-inspection" elevation={data.inspectionFiled ? 'none' : 'sm'}>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{t('inspection.jobCardTitle')}</Text>
            <Text variant="caption" tone="muted">
              {data.inspectionFiled ? t('inspection.jobCardFiled') : t('inspection.jobCardTodo')}
            </Text>
            {!data.inspectionFiled ? (
              <Button
                testID="open-inspection"
                label={t('inspection.jobCardAction')}
                variant="accent"
                onPress={() =>
                  router.push({ pathname: '/inspection', params: { id: data.orderId } })
                }
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {canRecordEvidence(data.status) ? (
        <Card elevation={evidenceReady ? 'sm' : 'none'}>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodyStrong">{t('provider.evidenceTitle')}</Text>
            <Text variant="caption" tone="muted">
              {evidenceReady ? t('provider.evidenceReady') : t('provider.evidenceRequired')}
            </Text>
            <Button
              testID="record-evidence"
              label={evidenceReady ? t('provider.evidenceEdit') : t('provider.evidenceAdd')}
              variant={evidenceReady ? 'secondary' : 'accent'}
              onPress={() => router.push({ pathname: '/evidence', params: { id: data.orderId } })}
            />
          </View>
        </Card>
      ) : null}

      {atTheCar && handover.data !== undefined && handover.data.issued ? (
        <Card testID="job-handover" style={{ gap: theme.spacing.sm }}>
          {handover.data.verified ? (
            <Text variant="bodyStrong" tone="success" testID="job-handover-verified">
              {t('handover.verifiedProvider')}
            </Text>
          ) : handover.data.locked ? (
            <Text variant="bodySmall" tone="warning">
              {t('handover.locked')}
            </Text>
          ) : (
            <>
              <Text variant="bodyStrong">{t('handover.title')}</Text>
              <Text variant="caption" tone="muted">
                {handoverRequired ? t('handover.requiredHint') : t('handover.hint')}
              </Text>
              <Row gap="sm" align="center">
                <View style={{ flex: 1 }}>
                  <Field
                    testID="job-handover-input"
                    label={t('handover.label')}
                    value={handoverInput}
                    onChangeText={(value) =>
                      setHandoverInput(value.replace(/[^0-9٠-٩]/g, '').slice(0, 4))
                    }
                    keyboardType="number-pad"
                    forceLtrInput
                    maxLength={4}
                  />
                </View>
              </Row>
              <Button
                testID="job-handover-verify"
                label={t('handover.verify')}
                variant="secondary"
                size="medium"
                loading={verifyHandover.isPending}
                disabled={toLatinDigits(handoverInput).length !== 4}
                onPress={() => verifyHandover.mutate(toLatinDigits(handoverInput))}
              />
              {handoverMessage !== null ? (
                <Text variant="caption" tone="warning">
                  {handoverMessage}
                </Text>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {step.action === 'none' ? (
        <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
          <Text variant="caption" tone="muted">
            {data.status === 'awaiting_approval'
              ? t('provider.awaitingCustomer')
              : t('job.waiting')}
          </Text>
        </Card>
      ) : (
        <Button
          testID="advance-job"
          label={t(step.labelKey)}
          onPress={() => advance.mutate()}
          loading={advance.isPending}
          disabled={blockedForEvidence || blockedForParts || blockedForInspection || handoverBlocks}
        />
      )}

      {notice !== undefined ? (
        <Text testID="job-notice" variant="bodySmall" tone="warning">
          {notice}
        </Text>
      ) : null}

      {blockedForParts ? (
        <Text variant="caption" style={{ color: theme.colors.warning }}>
          {t('provider.partsBlockHandBack')}
        </Text>
      ) : null}

      {blockedForInspection ? (
        <Text variant="caption" style={{ color: theme.colors.warning }}>
          {t('inspection.blocksHandBack')}
        </Text>
      ) : null}

      {blockedForEvidence ? (
        <Text variant="caption" style={{ color: theme.colors.warning }}>
          {t('provider.evidenceBlocks')}
        </Text>
      ) : null}

      {/* Only while the job is still an offer. Once it is yours there is
          nothing to decline — walking away then is a cancellation, which has
          different rules and different consequences. */}
      {step.action === 'accept' ? (
        <Button
          testID="decline-offer"
          label={t('job.decline')}
          variant="secondary"
          onPress={() => decline.mutate()}
          loading={decline.isPending}
        />
      ) : null}
    </Screen>
  );
}
