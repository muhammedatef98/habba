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

import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { canRecordEvidence, isEvidenceComplete, nextJobStep } from '@habba/core';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';

export default function JobScreen() {
  const { t } = useTranslation();
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

  const advance = useMutation({
    mutationFn: async () => {
      const current = job.data;
      if (current === null || current === undefined) return;

      const step = nextJobStep(current.status, current.fulfilmentMode);
      if (step.toStatus === null) return;

      if (step.action === 'accept') {
        await providerRepository.acceptJob(current.orderId);
      } else if (step.action === 'check_in_vehicle') {
        await providerRepository.checkInVehicle(current.orderId);
      } else {
        await providerRepository.advanceJob(current.orderId, step.toStatus);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['job', id] });
      await queryClient.invalidateQueries({ queryKey: ['open-jobs'] });
    },
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

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{data.serviceNameAr}</Text>
        <Text variant="caption" tone="muted">
          {data.orderNumber} · {t(`job.status.${data.status}`)}
        </Text>
      </View>

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
          disabled={blockedForEvidence}
        />
      )}

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
