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
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { canQuoteParts, canRecordEvidence, isEvidenceComplete, nextJobStep } from '@habba/core';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';
import { formatAppointment } from '@/features/shared/lib/dates';

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

  const data = job.data;

  if (data === null || data === undefined) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {job.isLoading ? t('common.loading') : t('errors.notFound')}
        </Text>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
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

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{data.serviceNameAr}</Text>
        <Text variant="caption" tone="muted">
          {data.orderNumber.length > 0
            ? `${data.orderNumber} · ${t(`job.status.${data.status}`)}`
            : t(`job.status.${data.status}`)}
        </Text>
        {data.scheduledFor !== null ? (
          <Text testID="job-scheduled" variant="bodyStrong">
            {t('provider.scheduledFor', {
              when: formatAppointment(data.scheduledFor, i18n.language),
            })}
          </Text>
        ) : null}
      </View>

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
              {t('provider.distanceLabel')}: {data.offer.distanceBucket}
              {data.offer.districtNameAr !== null ? ` · ${data.offer.districtNameAr}` : ''}
            </Text>
            {data.offer.estimatedPayout !== null ? (
              <Text variant="body" numeric>
                {t('provider.payoutLabel')}: {data.offer.estimatedPayout} {t('provider.sarSuffix')}
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
          disabled={blockedForEvidence || blockedForParts}
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

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
