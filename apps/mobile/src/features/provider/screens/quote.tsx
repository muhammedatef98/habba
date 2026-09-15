/**
 * عرض السعر — the parts and labour the customer is asked to approve.
 *
 * §1's sixth differentiator: parts line-itemed with part numbers, OEM flagged,
 * priced before approval. `order_parts` has had a table, a column guard and RLS
 * since 0019 and nothing has ever created a row, because there was no screen.
 *
 * ⚠️ Nothing on this screen computes a total.
 *
 * `parts_amount`, `vat_amount` and `total_amount` are derived server-side from
 * the lines and the labour (0068), and this screen reads them back rather than
 * predicting them. That looks like a missed optimisation until you notice what
 * the alternative is: a second implementation of the VAT arithmetic, living on
 * the device, deciding what a customer is charged. The figures shown here are
 * the figures the customer will approve, because they are literally the same
 * row.
 *
 * The consequence is a round trip after every edit, and the screen is honest
 * about it — the totals show as pending while the write is in flight rather
 * than optimistically updating to a number the server has not agreed to.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { sar } from '@habba/core';
import {
  Button,
  Card,
  Field,
  Icon,
  Screen,
  StatCluster,
  StatusPill,
  Text,
  rowDirectionFor,
  useTheme,
} from '@habba/ui';
import { providerRepository } from '@/features/provider/data/provider-repository';
import { repository } from '@/features/shared/data/repository';
import type { OrderPart } from '@/features/shared/data/types';

export default function ProviderQuoteScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = id ?? '';

  const parts = useQuery({
    queryKey: ['quote-parts', orderId],
    queryFn: () => providerRepository.listQuoteParts(orderId),
    enabled: orderId !== '',
  });

  // The order carries the derived money. Read, never written, from here.
  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => repository.getOrder(orderId),
    enabled: orderId !== '',
  });

  const [name, setName] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [warrantyDays, setWarrantyDays] = useState('');
  const [isOem, setIsOem] = useState(false);
  const [labourText, setLabourText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['quote-parts', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
    ]);
  };

  const addPart = useMutation({
    mutationFn: async () => {
      const price = sar(unitPrice);
      if (!price.ok) throw new Error('price');

      const count = Number(quantity);
      if (!Number.isInteger(count) || count < 1) throw new Error('quantity');

      await providerRepository.addQuotePart(orderId, {
        nameAr: name.trim(),
        // Empty is null, not ''. A part number nobody typed is absent, and an
        // empty string in the logbook reads as one that was recorded as blank.
        partNumber: partNumber.trim() === '' ? null : partNumber.trim(),
        isOem,
        quantity: count,
        unitPrice: price.amount,
        warrantyDays: warrantyDays.trim() === '' ? null : Number(warrantyDays),
      });
    },
    onSuccess: async () => {
      setName('');
      setPartNumber('');
      setQuantity('1');
      setUnitPrice('');
      setWarrantyDays('');
      setIsOem(false);
      setError(null);
      await refresh();
    },
    onError: (cause: Error) => {
      setError(
        cause.message === 'price'
          ? t('quoteBuild.errors.price')
          : cause.message === 'quantity'
            ? t('quoteBuild.errors.quantity')
            : t('quoteBuild.errors.saveFailed'),
      );
    },
  });

  const removePart = useMutation({
    mutationFn: (partId: string) => providerRepository.removeQuotePart(partId),
    onSuccess: refresh,
  });

  const saveLabour = useMutation({
    mutationFn: async () => {
      const amount = sar(labourText === '' ? '0' : labourText);
      if (!amount.ok) throw new Error('labour');
      await providerRepository.setLabour(orderId, amount.amount);
    },
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError: () => setError(t('quoteBuild.errors.labour')),
  });

  const lines = parts.data ?? [];
  const money = order.data;
  const busy = addPart.isPending || removePart.isPending || saveLabour.isPending;

  const nameValid = name.trim().length > 0;
  const priceValid = sar(unitPrice).ok;

  return (
    <Screen scrollable style={{ gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="title">{t('quoteBuild.title')}</Text>
        <Text variant="bodySmall" tone="muted">
          {t('quoteBuild.subtitle')}
        </Text>
      </View>

      {/* Totals first, because they are what the technician is trying to land
          on. Read back from the order — see the note at the top of this file. */}
      <Card elevation="sm" style={{ gap: theme.spacing.base }}>
        <StatCluster
          testID="quote-totals"
          items={[
            {
              key: 'parts',
              label: t('quoteBuild.parts'),
              value: money?.partsAmount ?? undefined,
            },
            {
              key: 'labour',
              label: t('quoteBuild.labour'),
              value: money?.labourAmount ?? undefined,
            },
            {
              key: 'total',
              label: t('quoteBuild.total'),
              value: money?.totalAmount ?? undefined,
              emphasis: 'accent',
            },
          ]}
        />
        <Text variant="caption" tone="subtle">
          {t('quoteBuild.vatNote')}
        </Text>
      </Card>

      {/* Parts already on the quote. The approval state is on every row,
          because an unapproved line is what will block the hand-back — and
          finding that out at the moment you try to leave is the worst time. */}
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="subheading">{t('quoteBuild.partsList')}</Text>

        {lines.length === 0 ? (
          <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
            <Text variant="bodySmall" tone="muted">
              {t('quoteBuild.noParts')}
            </Text>
          </Card>
        ) : (
          lines.map((line) => (
            <PartRow
              key={line.id}
              line={line}
              busy={busy}
              onRemove={() => removePart.mutate(line.id)}
            />
          ))
        )}
      </View>

      {/* Adding a line */}
      <Card style={{ gap: theme.spacing.md }}>
        <Text variant="bodyStrong">{t('quoteBuild.addPart')}</Text>

        <Field
          testID="part-name"
          label={t('quoteBuild.nameLabel')}
          value={name}
          onChangeText={setName}
        />
        <Field
          testID="part-number"
          label={t('quoteBuild.partNumberLabel')}
          hint={t('quoteBuild.partNumberHint')}
          value={partNumber}
          onChangeText={setPartNumber}
          forceLtrInput
        />

        <View
          style={{
            flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
            gap: theme.spacing.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Field
              testID="part-quantity"
              label={t('quoteBuild.quantityLabel')}
              value={quantity}
              onChangeText={(value) => setQuantity(value.replace(/\D/g, ''))}
              keyboardType="number-pad"
              forceLtrInput
            />
          </View>
          <View style={{ flex: 2 }}>
            <Field
              testID="part-price"
              label={t('quoteBuild.priceLabel')}
              hint={t('quoteBuild.priceHint')}
              value={unitPrice}
              onChangeText={setUnitPrice}
              keyboardType="decimal-pad"
              forceLtrInput
            />
          </View>
        </View>

        <Field
          testID="part-warranty"
          label={t('quoteBuild.warrantyLabel')}
          hint={t('quoteBuild.warrantyHint')}
          value={warrantyDays}
          onChangeText={(value) => setWarrantyDays(value.replace(/\D/g, ''))}
          keyboardType="number-pad"
          forceLtrInput
        />

        {/* OEM vs aftermarket is the single fact a customer most wants and is
            least often told. It is a deliberate two-state choice rather than a
            switch defaulting to "original": a technician tapping through would
            otherwise claim OEM for every line without ever saying so. */}
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" tone="muted">
            {t('quoteBuild.originLabel')}
          </Text>
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              gap: theme.spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <Button
                testID="part-oem"
                label={t('quoteBuild.oem')}
                variant={isOem ? 'primary' : 'secondary'}
                size="medium"
                onPress={() => setIsOem(true)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="part-aftermarket"
                label={t('quoteBuild.aftermarket')}
                variant={isOem ? 'secondary' : 'primary'}
                size="medium"
                onPress={() => setIsOem(false)}
              />
            </View>
          </View>
        </View>

        <Button
          testID="add-part"
          label={t('quoteBuild.addPartAction')}
          onPress={() => addPart.mutate()}
          loading={addPart.isPending}
          disabled={!nameValid || !priceValid || busy}
        />
      </Card>

      {/* Labour */}
      <Card style={{ gap: theme.spacing.md }}>
        <Text variant="bodyStrong">{t('quoteBuild.labourTitle')}</Text>
        <Field
          testID="labour-amount"
          label={t('quoteBuild.labourLabel')}
          hint={t('quoteBuild.priceHint')}
          value={labourText}
          onChangeText={setLabourText}
          keyboardType="decimal-pad"
          forceLtrInput
        />
        <Button
          testID="save-labour"
          label={t('quoteBuild.saveLabour')}
          variant="secondary"
          onPress={() => saveLabour.mutate()}
          loading={saveLabour.isPending}
          disabled={busy}
        />
      </Card>

      {error !== null ? (
        <Text testID="quote-error" variant="caption" tone="emergency">
          {error}
        </Text>
      ) : null}

      {/* Said plainly, at the bottom, where someone decides they are finished:
          the customer approves each line and the job cannot be handed back
          until they have. Learning that from a refused hand-back is learning it
          too late. */}
      <Card elevation="none" style={{ backgroundColor: theme.colors.surfaceSunken }}>
        <Text variant="caption" tone="muted">
          {t('quoteBuild.approvalNote')}
        </Text>
      </Card>

      <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function PartRow({
  line,
  busy,
  onRemove,
}: {
  readonly line: OrderPart;
  readonly busy: boolean;
  readonly onRemove: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Card
      testID={`quote-part-${line.id}`}
      elevation="none"
      style={{
        backgroundColor: theme.colors.surfaceSunken,
        gap: theme.spacing.sm,
        borderWidth: 1,
        borderColor: line.approvedByCustomer ? theme.colors.successBorder : theme.colors.border,
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
          <Text variant="bodySmall">{line.nameAr}</Text>
          <Text variant="caption" tone="subtle" numeric>
            {line.partNumber ?? t('quoteBuild.noPartNumber')} ·{' '}
            {t(line.isOem ? 'quoteBuild.oem' : 'quoteBuild.aftermarket')}
          </Text>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text variant="bodyStrong" numeric>
            {t('quoteBuild.lineTotal', { quantity: line.quantity, price: line.unitPrice })}
          </Text>
          <StatusPill
            tone={line.approvedByCustomer ? 'success' : 'neutral'}
            showDot={false}
            label={t(
              line.approvedByCustomer ? 'quoteBuild.approved' : 'quoteBuild.awaitingApproval',
            )}
          />
        </View>
      </View>

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        {line.warrantyDays !== null ? (
          <View
            style={{
              flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
              alignItems: 'center',
              gap: theme.spacing.xs,
              flex: 1,
            }}
          >
            <Icon name="check" size={theme.iconSize.sm} color={theme.colors.textSubtle} />
            <Text variant="caption" tone="subtle">
              {t('quoteBuild.warrantyDays', { count: line.warrantyDays })}
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        <Button
          testID={`remove-part-${line.id}`}
          label={t('quoteBuild.remove')}
          variant="ghost"
          size="medium"
          fullWidth={false}
          disabled={busy}
          onPress={onRemove}
        />
      </View>
    </Card>
  );
}
