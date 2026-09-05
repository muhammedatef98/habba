/**
 * The provider's assigned jobs.
 *
 * Deliberately narrow: only live jobs. Finished work belongs in earnings, and
 * a list mixing the two makes the one job that actually needs attention
 * harder to find while standing beside a car.
 */

import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isEvidenceComplete } from '@habba/core';
import { Button, Card, Screen, Text, useTheme } from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';

export default function MyJobsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  const jobs = useQuery({
    queryKey: ['my-jobs'],
    queryFn: () => providerRepository.listMyJobs(),
  });

  const rows = jobs.data ?? [];

  return (
    <Screen scrollable>
      <Text variant="title">{t('provider.myJobs')}</Text>

      {rows.length === 0 ? (
        <Text variant="body" tone="muted">
          {t('provider.noOpenJobs')}
        </Text>
      ) : null}

      <View style={{ gap: theme.spacing.md }}>
        {rows.map((job) => {
          const evidenceReady = isEvidenceComplete(
            {
              requiresMileage: job.requiresCompletionMileage,
              requiresPhotos: job.requiresCompletionPhotos,
            },
            job.completionMileage,
            job.completionMedia,
          );

          // Surfaced on the list, not just inside the job: a technician with
          // three open jobs should see at a glance which one is blocked from
          // being handed back.
          const needsEvidence = job.status === 'in_progress' && !evidenceReady;

          return (
            <Pressable
              key={job.orderId}
              testID={`my-job-${job.orderId}`}
              onPress={() => router.push({ pathname: '/job', params: { id: job.orderId } })}
              accessibilityRole="button"
              accessibilityLabel={job.serviceNameAr}
            >
              <Card>
                <View style={{ gap: theme.spacing.xs }}>
                  <Text variant="heading">{job.serviceNameAr}</Text>
                  <Text variant="caption" tone="muted">
                    {job.orderNumber} · {t(`job.status.${job.status}`)}
                  </Text>
                  {needsEvidence ? (
                    <Text variant="caption" style={{ color: theme.colors.warning }}>
                      {t('provider.evidenceRequired')}
                    </Text>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
