/**
 * Which payment provider this build uses.
 *
 * No Moyasar publishable key: the development provider, whose authorisation
 * the database accepts from the phone (and only while `payments_gateway` is
 * `dev` — 0077 refuses it otherwise).
 *
 * A key: Moyasar. The card form (lib/moyasar-card-form.ts) authorises the
 * card, and the hold is recorded by the `payments` Edge Function after it has
 * checked the payment with the secret key — never on the phone's word.
 */

import Constants from 'expo-constants';
import type { SupabaseClient } from '@supabase/supabase-js';
import { halalasOf, type SarAmount } from '@habba/core';
import {
  AUTHORISATION_VALIDITY_DAYS,
  DevPaymentProvider,
  type AuthorisationResult,
  type CaptureResult,
  type PaymentProvider,
  type RefundResult,
} from './payments';
import { collectCardPayment, type CardFormCollector } from './moyasar-card-form';

export class MoyasarPaymentProvider implements PaymentProvider {
  constructor(
    private readonly publishableKey: string,
    private readonly client: SupabaseClient,
    private readonly collect: CardFormCollector | null,
  ) {}

  async authorise(orderId: string, amount: SarAmount): Promise<AuthorisationResult> {
    if (this.collect === null) return { ok: false, reason: 'card_form_unavailable' };

    const card = await this.collect({
      publishableKey: this.publishableKey,
      orderId,
      amountHalalas: halalasOf(amount),
      description: `هبّة — طلب ${orderId.slice(0, 8)}`,
    });
    if (card.status === 'cancelled') return { ok: false, reason: 'cancelled' };
    if (card.status === 'failed') return { ok: false, reason: 'declined' };

    const { data, error } = await this.client.functions.invoke('payments', {
      body: { action: 'confirm', order_id: orderId, payment_id: card.paymentId },
    });
    if (error !== null || (data as { ok?: boolean } | null)?.ok !== true) {
      return { ok: false, reason: 'declined' };
    }

    return {
      ok: true,
      paymentIntentId: card.paymentId,
      expiresAt: new Date(Date.now() + AUTHORISATION_VALIDITY_DAYS * 86_400_000),
      recordedByServer: true,
    };
  }

  // Money moves on the server (the `payments` function's tick, 0077). The
  // phone asks for a capture by confirming the job, never by calling Moyasar.
  async capture(): Promise<CaptureResult> {
    return { ok: false, reason: 'transport_failed' };
  }

  async release(): Promise<RefundResult> {
    return { ok: false, reason: 'transport_failed' };
  }

  async refund(): Promise<RefundResult> {
    return { ok: false, reason: 'transport_failed' };
  }
}

export function createPaymentProvider(client: SupabaseClient): PaymentProvider {
  const key = (Constants.expoConfig?.extra as { moyasarPublishableKey?: string } | undefined)
    ?.moyasarPublishableKey;
  if (key === undefined || key.trim() === '') return new DevPaymentProvider();
  return new MoyasarPaymentProvider(key.trim(), client, collectCardPayment);
}
