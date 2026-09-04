/**
 * The provider's assigned jobs.
 *
 * Deliberately narrow: only live jobs. Finished work belongs in earnings, and
 * a list mixing the two makes the one job that actually needs attention harder
 * to find while standing beside a car.
 *
 * The evidence warning is the reason this list exists in the shape it does.
 * §9.2 makes mileage and before/after photos mandatory before a job can be
 * handed back, and 0032 enforces it server-side — so a technician with three
 * open jobs needs to see which one is blocked without opening all three. It is
 * a badge on the row rather than a caption inside it.
 */

import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isEvidenceComplete } from '@habba/core';
import { Button, Card, Icon, Screen, StatusPill, Text, rowDirectionFor, useTheme } from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';
import { Pressable } from 'react-native';

export default function MyJobsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  const jobs = useQuery({
    queryKey: ['my-jobs'],
    queryFn: () => providerRepository.listMyJobs(),
  });

  const rows = jobs.data ?? [];

  if (rows.length === 0) {
    return (
      <Screen>
        <Text variant="title">{t('provider.myJobs')}</Text>
        <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg }}>
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: theme.radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.surfaceSunken,
              }}
            >
              <Icon name="wrench" size={28} color={theme.colors.textSubtle} />
            </View>
            <Text variant="bodySmall" tone="muted" align="center">
              {t('provider.noMyJobs')}
            </Text>
          </View>

          <Button
            testID="go-to-shift"
            label={t('provider.goToShift')}
            variant="secondary"
            onPress={() => router.replace('/')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scrollable style={{ gap: theme.spacing.base }}>
      <Text variant="title">{t('provider.myJobs')}</Text>

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

          const needsEvidence = job.status === 'in_progress' && !evidenceReady;

          return (
            <Pressable
              key={job.orderId}
              testID={`my-job-${job.orderId}`}
              onPress={() => router.push({ pathname: '/job', params: { id: job.orderId } })}
              accessibilityRole="button"
              accessibilityLabel={job.serviceNameAr}
              style={({ pressed }) => [pressed ? { opacity: 0.9 } : null]}
            >
              <Card
                elevation="sm"
                style={{
                  gap: theme.spacing.md,
                  // A blocked job wears the warning rather than mentioning it:
                  // this is the row the technician has to come back to.
                  borderColor: needsEvidence ? theme.colors.warning : theme.colors.border,
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
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="heading" numberOfLines={2}>
                      {job.serviceNameAr}
                    </Text>
                    <Text variant="caption" tone="subtle" numeric>
                      {job.orderNumber}
                    </Text>
                  </View>

                  <StatusPill
                    tone={job.status === 'in_progress' ? 'active' : 'neutral'}
                    showDot={job.status === 'in_progress'}
                    label={t(`job.status.${job.status}`)}
                  />
                </View>

                {needsEvidence ? (
                  <View
                    style={{
                      flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.border,
                      paddingTop: theme.spacing.md,
                    }}
                  >
                    <Icon name="alert" size={theme.iconSize.sm} color={theme.colors.warningFg} />
                    <Text variant="caption" tone="warning" style={{ flex: 1 }}>
                      {t('provider.evidenceRequired')}
                    </Text>
                  </View>
                ) : null}
              </Card>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
