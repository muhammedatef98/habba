/**
 * "Something is wrong with the work" — the customer's complaint (0070).
 *
 * Collapsed to one quiet button under the receipt: most finished jobs are
 * fine, and a complaint form on every receipt would suggest otherwise. Opening
 * it asks what went wrong; sending it puts the order in front of Habba's team
 * and holds the provider's payment until they decide.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Field, Text, useTheme } from '@habba/ui';
import { repository } from '@/features/shared/data/repository';

export function ReportProblem({ orderId }: { readonly orderId: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const send = useMutation({
    mutationFn: () => repository.openOrderDispute(orderId, reason.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['recent-orders'] });
    },
  });

  if (!open) {
    return (
      <Button
        testID="report-problem"
        label={t('tracking.reportProblem')}
        variant="ghost"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <Card testID="report-problem-form" elevation="sm" style={{ gap: theme.spacing.md }}>
      <Text variant="bodyStrong">{t('tracking.reportProblemTitle')}</Text>
      <Text variant="caption" tone="muted">
        {t('tracking.reportProblemHint')}
      </Text>
      <Field
        label={t('tracking.reportProblemField')}
        value={reason}
        onChangeText={setReason}
        placeholder={t('tracking.reportProblemPlaceholder')}
        multiline
      />
      {send.isError ? (
        <Text variant="caption" tone="emergency">
          {t('tracking.reportProblemFailed')}
        </Text>
      ) : null}
      <View style={{ gap: theme.spacing.sm }}>
        <Button
          testID="report-problem-submit"
          label={t('tracking.reportProblemSubmit')}
          onPress={() => send.mutate()}
          loading={send.isPending}
          disabled={reason.trim().length < 3}
        />
        <Button label={t('common.back')} variant="ghost" onPress={() => setOpen(false)} />
      </View>
    </Card>
  );
}
