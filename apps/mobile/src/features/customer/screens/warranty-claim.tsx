/**
 * Claim a warranty — the work failed inside its cover, so it is redone free
 * by the provider who did it (CLAUDE.md §1.5, 0105).
 *
 * Reached from the logbook's live warranties. One description of what went
 * wrong and, for a job done at the car rather than at a workshop, where the
 * car is now: the original address belongs to whoever paid for it (0055), so
 * a new owner, or a car that has moved, needs the current spot. The server
 * confirms the re-service with the same provider in the same call and tells
 * them; the customer lands on the order's tracking screen.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Icon, Row, Screen, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';
import { BackBar } from '@/features/shared/components/BackBar';
import { locationProvider } from '@/features/shared/lib/location';

type Where = 'original' | 'here';

const REFUSALS: Record<string, string> = {
  'warranty:open_claim': 'warranty.errorOpenClaim',
  'warranty:location': 'warranty.errorLocation',
  'warranty:expired': 'warranty.errorExpired',
  'warranty:not_owner': 'warranty.errorNotOwner',
  'warranty:problem': 'warranty.errorProblem',
};

export default function WarrantyClaimScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    order?: string;
    vehicle?: string;
    service?: string;
    provider?: string;
    mode?: string;
  }>();
  const orderId = typeof params.order === 'string' ? params.order : undefined;
  const atWorkshop = params.mode === 'workshop';

  const [problem, setProblem] = useState('');
  const [where, setWhere] = useState<Where>('original');
  const [error, setError] = useState<string | null>(null);

  const claim = useMutation({
    mutationFn: async () => {
      if (orderId === undefined) throw new Error('warranty:missing');
      if (atWorkshop || where === 'original') {
        return repository.requestWarrantyService({ orderId, problem: problem.trim() });
      }
      const fix = await locationProvider.getCurrentLocation();
      if (!fix.ok) throw new Error('warranty:no_fix');
      const addressAr = (await locationProvider.describe(fix.location)) ?? undefined;
      return repository.requestWarrantyService({
        orderId,
        problem: problem.trim(),
        location: fix.location,
        ...(addressAr !== undefined ? { addressAr } : {}),
      });
    },
    meta: { inlineError: true },
    onMutate: () => setError(null),
    onSuccess: async (claimId) => {
      await queryClient.invalidateQueries({ queryKey: ['warranties'] });
      await queryClient.invalidateQueries({ queryKey: ['recent-orders'] });
      router.replace({ pathname: '/tracking', params: { id: claimId } });
    },
    onError: (cause) => {
      const message = cause instanceof Error ? cause.message : '';
      if (message === 'warranty:location') setWhere('here');
      setError(
        message === 'warranty:no_fix'
          ? t('warranty.errorNoFix')
          : t(REFUSALS[message] ?? 'warranty.errorGeneric'),
      );
    },
  });

  if (orderId === undefined) return <Redirect href="/vehicles" />;

  const ready = problem.trim().length >= 5;

  const option = (value: Where, title: string, body: string) => {
    const on = where === value;
    return (
      <Card
        key={value}
        testID={`warranty-where-${value}`}
        selected={on}
        elevation="none"
        onPress={() => setWhere(value)}
        style={{
          borderWidth: on ? 1.5 : 1,
          borderColor: on ? theme.colors.primary : theme.colors.border,
          gap: 2,
        }}
      >
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="muted">
          {body}
        </Text>
      </Card>
    );
  };

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }} testID="warranty-claim">
      <BackBar label={t('warranty.title')} />

      <Card
        elevation="none"
        style={{ backgroundColor: theme.colors.successSubtle, gap: theme.spacing.sm }}
      >
        <Row gap="sm" align="center">
          <Icon name="check" size={theme.iconSize.md} color={theme.colors.success} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {params.service ?? t('warranty.title')}
          </Text>
        </Row>
        <Text variant="bodySmall" tone="muted">
          {t('warranty.promise', { provider: params.provider ?? t('warranty.sameProvider') })}
        </Text>
      </Card>

      <Field
        testID="warranty-problem"
        label={t('warranty.problemLabel')}
        hint={t('warranty.problemHint')}
        value={problem}
        onChangeText={setProblem}
        multiline
        maxLength={500}
      />

      {atWorkshop ? (
        <Text variant="caption" tone="muted">
          {t('warranty.workshopNote')}
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('warranty.whereLabel')}
          </Text>
          {option('original', t('warranty.whereOriginal'), t('warranty.whereOriginalHint'))}
          {option('here', t('warranty.whereHere'), t('warranty.whereHereHint'))}
        </View>
      )}

      {error !== null ? (
        <Text variant="bodySmall" tone="emergency" testID="warranty-error">
          {error}
        </Text>
      ) : null}

      <Button
        testID="warranty-submit"
        label={t('warranty.submit')}
        loading={claim.isPending}
        disabled={!ready}
        onPress={() => claim.mutate()}
      />
      <Text variant="caption" tone="subtle" style={{ textAlign: 'center' }}>
        {t('warranty.free')}
      </Text>
    </Screen>
  );
}
