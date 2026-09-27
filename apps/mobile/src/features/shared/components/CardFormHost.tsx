/**
 * The card form, over whatever screen asked for a payment.
 *
 * Mounted once at the root. It renders nothing until MoyasarPaymentProvider
 * asks for a card (state/card-form.ts), then shows the amount and four fields,
 * and settles the request when the card is authorised or the customer backs
 * out. The typed card lives only in this component's state and is dropped the
 * moment the form closes.
 */

import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CardField } from '@habba/core';
import { Button, Field, Row, Screen, Text, useTheme } from '@habba/ui';
import { useCardForm } from '@/features/shared/state/card-form';
import { payWithCard } from '@/features/shared/lib/moyasar-card-form';

const EMPTY = { name: '', number: '', expiry: '', cvc: '' };

/** "4111111111111111" → "4111 1111 1111 1111", as it is printed on the card. */
function groupDigits(value: string): string {
  return value
    .replace(/[^\d٠-٩۰-۹]/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function slashExpiry(value: string): string {
  const digits = value.replace(/[^\d٠-٩۰-۹]/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function CardFormHost() {
  const { t } = useTranslation();
  const theme = useTheme();
  const request = useCardForm((state) => state.request);
  const finish = useCardForm((state) => state.finish);

  const [card, setCard] = useState(EMPTY);
  const [invalid, setInvalid] = useState<readonly CardField[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new request starts from a blank form: nothing from a previous card.
  useEffect(() => {
    setCard(EMPTY);
    setInvalid([]);
    setProblem(null);
    setBusy(false);
  }, [request]);

  if (request === null) return null;

  const set = (field: keyof typeof EMPTY) => (value: string) => {
    setCard((current) => ({ ...current, [field]: value }));
    setInvalid((current) => current.filter((f) => f !== field));
  };
  const errorFor = (field: CardField) =>
    invalid.includes(field) ? t(`cardForm.invalid.${field}`) : undefined;

  async function pay() {
    if (request === null) return;
    setBusy(true);
    setProblem(null);
    const attempt = await payWithCard(request, card);
    setBusy(false);

    switch (attempt.status) {
      case 'authorised':
        finish({ status: 'authorised', paymentId: attempt.paymentId });
        return;
      case 'invalid':
        setInvalid(attempt.fields);
        return;
      case 'declined':
        setProblem(
          attempt.message === ''
            ? t('cardForm.declined')
            : t('cardForm.declinedWith', { reason: attempt.message }),
        );
        return;
      case 'unverified':
        setProblem(t('cardForm.unverified'));
        return;
      case 'network':
        setProblem(t('cardForm.network'));
    }
  }

  const amount = (request.amountHalalas / 100).toFixed(2).replace(/\.00$/, '');

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => (busy ? undefined : finish({ status: 'cancelled' }))}
    >
      <Screen scrollable>
        <Text variant="title">{t('cardForm.title')}</Text>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" numeric testID="card-amount">
            {t('cardForm.amount', { amount })}
          </Text>
          <Text variant="caption" tone="muted">
            {t('cardForm.holdNote')}
          </Text>
        </View>

        <Field
          testID="card-name"
          label={t('cardForm.name')}
          value={card.name}
          onChangeText={set('name')}
          autoCapitalize="characters"
          autoComplete="cc-name"
          forceLtrInput
          error={errorFor('name')}
        />
        <Field
          testID="card-number"
          label={t('cardForm.number')}
          value={card.number}
          onChangeText={(value) => set('number')(groupDigits(value))}
          keyboardType="number-pad"
          autoComplete="cc-number"
          forceLtrInput
          error={errorFor('number')}
        />
        <Row gap="sm" align="flex-start">
          <View style={{ flex: 1 }}>
            <Field
              testID="card-expiry"
              label={t('cardForm.expiry')}
              placeholder="MM/YY"
              value={card.expiry}
              onChangeText={(value) => set('expiry')(slashExpiry(value))}
              keyboardType="number-pad"
              autoComplete="cc-exp"
              forceLtrInput
              error={errorFor('expiry')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              testID="card-cvc"
              label={t('cardForm.cvc')}
              value={card.cvc}
              onChangeText={set('cvc')}
              keyboardType="number-pad"
              autoComplete="cc-csc"
              secureTextEntry
              maxLength={4}
              forceLtrInput
              error={errorFor('cvc')}
            />
          </View>
        </Row>

        {problem !== null ? (
          <Text variant="caption" tone="emergency" testID="card-problem">
            {problem}
          </Text>
        ) : null}

        <Text variant="caption" tone="subtle">
          {t('cardForm.secureNote')}
        </Text>

        <Button testID="card-pay" label={t('cardForm.pay')} onPress={pay} loading={busy} />
        <Button
          label={t('common.cancel')}
          variant="ghost"
          disabled={busy}
          onPress={() => finish({ status: 'cancelled' })}
        />
      </Screen>
    </Modal>
  );
}
