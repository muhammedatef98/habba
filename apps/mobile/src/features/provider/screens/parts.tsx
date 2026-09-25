/**
 * Quoting parts on a job.
 *
 * §1 differentiator 6: every part line-itemed, with its part number, OEM or
 * aftermarket said plainly, and a price the customer sees before approving.
 * Each line sent from here reaches the customer as a question (0067) — they
 * approve or decline it — and the job cannot be handed back until every line
 * has an answer. So the screen leads with where each answer stands, and the
 * form is short enough to fill in beside the car.
 *
 * The price typed here is per unit and before VAT, as the server bills it.
 * It is parsed into an exact SAR amount before it goes anywhere (ADR-0007):
 * "349.5" is 349.50, and "abc" or "12.345" is refused on the screen rather
 * than by the database.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { canQuoteParts, multiplySar, sar } from '@habba/core';
import { Button, Card, Field, Row, Screen, StatusPill, Text, useTheme } from '@habba/ui';
import { providerRepository, type QuotedPart } from '@/features/provider/data/provider-repository';
import { useLiveRefresh } from '@/features/shared/lib/live';
import { formatSarDisplay } from '@/features/shared/lib/money-format';

type FormError = 'name' | 'quantity' | 'price' | 'warranty';

const ANSWER_PILL: Record<
  QuotedPart['answer'],
  { tone: 'active' | 'success' | 'neutral'; key: string }
> = {
  pending: { tone: 'active', key: 'provider.partPending' },
  approved: { tone: 'success', key: 'provider.partApproved' },
  declined: { tone: 'neutral', key: 'provider.partDeclined' },
};

export default function PartsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => providerRepository.getJob(id ?? ''),
    enabled: id !== undefined,
  });

  const parts = useQuery({
    queryKey: ['job-parts', id],
    queryFn: () => providerRepository.listParts(id ?? ''),
    enabled: id !== undefined,
    // The customer answers from their own phone; this is where the technician
    // watches for it.
    refetchInterval: 5000,
  });

  const [nameAr, setNameAr] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [isOem, setIsOem] = useState(false);
  const [quantityText, setQuantityText] = useState('1');
  const [priceText, setPriceText] = useState('');
  const [warrantyText, setWarrantyText] = useState('');
  const [formError, setFormError] = useState<FormError | undefined>(undefined);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['job-parts', id] });
    await queryClient.invalidateQueries({ queryKey: ['job', id] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const quantity = Number(quantityText);
      const price = sar(priceText);
      const warranty = warrantyText.trim() === '' ? undefined : Number(warrantyText);

      if (nameAr.trim().length === 0) throw new Error('name');
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error('quantity');
      if (!price.ok || price.amount.startsWith('-')) throw new Error('price');
      if (warranty !== undefined && (!Number.isInteger(warranty) || warranty > 730)) {
        throw new Error('warranty');
      }

      await providerRepository.addPart(id ?? '', {
        nameAr,
        partNumber,
        isOem,
        quantity,
        unitPrice: price.amount,
        warrantyDays: warranty,
      });
    },
    onMutate: () => setFormError(undefined),
    onSuccess: async () => {
      setNameAr('');
      setPartNumber('');
      setIsOem(false);
      setQuantityText('1');
      setPriceText('');
      setWarrantyText('');
      await refresh();
    },
    onError: (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : '';
      if (
        message === 'name' ||
        message === 'quantity' ||
        message === 'price' ||
        message === 'warranty'
      ) {
        setFormError(message);
      }
    },
  });

  const remove = useMutation({
    mutationFn: (partId: string) => providerRepository.removePart(partId),
    onSuccess: refresh,
  });

  useLiveRefresh(
    [{ table: 'order_parts', filter: `order_id=eq.${id ?? ''}` }],
    [
      ['job-parts', id],
      ['job', id],
    ],
    id !== undefined,
  );

  const open = job.data !== null && job.data !== undefined && canQuoteParts(job.data.status);
  const lines = parts.data ?? [];

  return (
    <Screen scrollable>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('provider.partsTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('provider.partsWhy')}
        </Text>
      </View>

      {lines.length === 0 ? (
        <Text variant="caption" tone="subtle">
          {t('provider.noParts')}
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {lines.map((line) => (
            <Card
              key={line.id}
              testID={`part-${line.id}`}
              elevation="none"
              style={{
                gap: theme.spacing.xs,
                backgroundColor:
                  line.answer === 'declined' ? theme.colors.surfaceSunken : theme.colors.surface,
              }}
            >
              <Row gap="sm" justify="space-between">
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {line.nameAr}
                </Text>
                <StatusPill
                  tone={ANSWER_PILL[line.answer].tone}
                  showDot={line.answer === 'pending'}
                  label={t(ANSWER_PILL[line.answer].key)}
                />
              </Row>
              <Text variant="caption" tone="muted">
                {[
                  line.isOem ? t('provider.partOem') : t('provider.partAftermarket'),
                  line.partNumber,
                  t('quote.quantity', { quantity: line.quantity }),
                ]
                  .filter((piece) => piece !== null && piece !== '')
                  .join(' · ')}
              </Text>
              <Text variant="body" numeric>
                {t('common.sar', {
                  amount: formatSarDisplay(multiplySar(line.unitPrice, line.quantity)),
                })}
              </Text>
              {/* A declined line is the record of a "no" and stays (0067). */}
              {open && line.answer !== 'declined' ? (
                <Button
                  testID={`remove-part-${line.id}`}
                  label={t('provider.partRemove')}
                  variant="ghost"
                  size="medium"
                  onPress={() => remove.mutate(line.id)}
                  loading={remove.isPending && remove.variables === line.id}
                />
              ) : null}
            </Card>
          ))}
        </View>
      )}

      {open ? (
        <Card elevation="sm" style={{ gap: theme.spacing.md }}>
          <Field
            testID="part-name"
            label={t('provider.partName')}
            value={nameAr}
            onChangeText={setNameAr}
            error={formError === 'name' ? t('provider.partErrorName') : undefined}
          />
          <Field
            testID="part-number"
            label={t('provider.partNumber')}
            value={partNumber}
            onChangeText={setPartNumber}
            forceLtrInput
          />
          <Row gap="sm">
            {([false, true] as const).map((oem) => {
              const selected = isOem === oem;
              return (
                <Card
                  selected={selected}
                  key={String(oem)}
                  testID={oem ? 'part-oem' : 'part-aftermarket'}
                  elevation="none"
                  onPress={() => setIsOem(oem)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    minHeight: theme.minTouchTarget,
                    justifyContent: 'center',
                    backgroundColor: selected
                      ? theme.colors.primarySubtle
                      : theme.colors.surfaceSunken,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    borderWidth: selected ? 1.5 : 1,
                  }}
                >
                  <Text variant="bodySmall" tone={selected ? 'primary' : 'muted'}>
                    {oem ? t('provider.partOem') : t('provider.partAftermarket')}
                  </Text>
                </Card>
              );
            })}
          </Row>
          <Row gap="sm" align="flex-start">
            <View style={{ flex: 1 }}>
              <Field
                testID="part-quantity"
                label={t('provider.partQuantity')}
                value={quantityText}
                onChangeText={(value) => setQuantityText(value.replace(/\D/g, ''))}
                keyboardType="number-pad"
                forceLtrInput
                error={formError === 'quantity' ? t('provider.partErrorQuantity') : undefined}
              />
            </View>
            <View style={{ flex: 2 }}>
              <Field
                testID="part-price"
                label={t('provider.partUnitPrice')}
                value={priceText}
                onChangeText={(value) => setPriceText(value.replace(/[^\d.]/g, ''))}
                keyboardType="decimal-pad"
                forceLtrInput
                error={formError === 'price' ? t('provider.partErrorPrice') : undefined}
              />
            </View>
          </Row>
          <Field
            testID="part-warranty"
            label={t('provider.partWarranty')}
            value={warrantyText}
            onChangeText={(value) => setWarrantyText(value.replace(/\D/g, ''))}
            keyboardType="number-pad"
            forceLtrInput
            error={formError === 'warranty' ? t('provider.partErrorWarranty') : undefined}
          />

          {add.isError && formError === undefined ? (
            <Text variant="caption" tone="emergency">
              {t('provider.partSendFailed')}
            </Text>
          ) : null}

          <Button
            testID="part-send"
            label={t('provider.partSend')}
            onPress={() => add.mutate()}
            loading={add.isPending}
          />
        </Card>
      ) : null}

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
