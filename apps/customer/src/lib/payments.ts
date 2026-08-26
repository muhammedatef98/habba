/**
 * Payment authorisation and capture, behind an interface.
 *
 * ⚠️ OPEN DECISION — ADR-0008 blocks the real implementation, and it is a
 * legal question before it is an engineering one:
 *
 *   * Card authorise/capture is NOT escrow. It holds funds on the customer's
 *     card, not in an account Habba controls, and authorisations expire
 *     (typically ~7 days) and can be reduced by the issuer sooner.
 *   * Capture is usually capped at the authorised amount — which breaks the
 *     core flow, because the price after diagnosis and parts approval is
 *     routinely HIGHER than the booking estimate. `capture()` below returns an
 *     explicit `exceeds_authorisation` result rather than pretending
 *     otherwise, so the state machine has to confront it.
 *   * mada is a domestic debit scheme; manual-capture support must be verified
 *     against Moyasar's sandbox rather than assumed from Visa/Mastercard
 *     behaviour.
 *   * If Habba collects and later disburses provider funds, that is arguably a
 *     payment service under SAMA supervision.
 *
 * Until those land, `DevPaymentProvider` lets the whole order pipeline —
 * authorisation guards, capture timing, refunds, the dispute window — be built
 * and tested. Only the transport is stubbed.
 */

import type { SarAmount } from '@habba/core';

export type AuthorisationResult =
  | { readonly ok: true; readonly paymentIntentId: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: 'declined' | 'insufficient_funds' | 'transport_failed' };

export type CaptureResult =
  | { readonly ok: true; readonly capturedAmount: SarAmount }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_authorised'
        | 'already_captured'
        | 'authorisation_expired'
        /** The final price exceeded what was authorised. Needs re-authorisation. */
        | 'exceeds_authorisation'
        | 'transport_failed';
    };

export type RefundResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'not_captured' | 'already_refunded' | 'transport_failed';
    };

export interface PaymentProvider {
  /** Holds funds at booking. The order cannot be accepted until this succeeds. */
  authorise(orderId: string, amount: SarAmount): Promise<AuthorisationResult>;
  /** Takes the money. Called only after the customer confirms, or after the dispute window. */
  capture(paymentIntentId: string, amount: SarAmount): Promise<CaptureResult>;
  release(paymentIntentId: string): Promise<RefundResult>;
  refund(paymentIntentId: string, amount: SarAmount): Promise<RefundResult>;
}

/** Mirrors the ~7 day card authorisation window so the expiry path is exercisable. */
export const AUTHORISATION_VALIDITY_DAYS = 7;

interface Intent {
  readonly orderId: string;
  readonly authorisedAmount: SarAmount;
  readonly expiresAt: number;
  captured: boolean;
  refunded: boolean;
}

/**
 * Development provider.
 *
 * It deliberately reproduces the awkward constraints of real card
 * authorisation rather than being permissive. A stub that happily captures
 * more than it authorised would let the team build a flow that cannot work
 * against a real PSP, and the failure would surface in Phase 3 integration
 * with a launch date attached.
 */
export class DevPaymentProvider implements PaymentProvider {
  private readonly intents = new Map<string, Intent>();
  private counter = 0;

  async authorise(orderId: string, amount: SarAmount): Promise<AuthorisationResult> {
    this.counter += 1;
    const paymentIntentId = `dev_intent_${this.counter}`;
    const expiresAt = new Date(Date.now() + AUTHORISATION_VALIDITY_DAYS * 86_400_000);

    this.intents.set(paymentIntentId, {
      orderId,
      authorisedAmount: amount,
      expiresAt: expiresAt.getTime(),
      captured: false,
      refunded: false,
    });

    return { ok: true, paymentIntentId, expiresAt };
  }

  async capture(paymentIntentId: string, amount: SarAmount): Promise<CaptureResult> {
    const intent = this.intents.get(paymentIntentId);
    if (intent === undefined) return { ok: false, reason: 'not_authorised' };
    if (intent.captured) return { ok: false, reason: 'already_captured' };
    if (Date.now() > intent.expiresAt) return { ok: false, reason: 'authorisation_expired' };

    // The constraint that shapes the product: you cannot take more than you
    // held. A quote that grew after diagnosis needs re-authorisation, which is
    // an extra customer interaction that must be designed, not patched in.
    if (compareAmounts(amount, intent.authorisedAmount) > 0) {
      return { ok: false, reason: 'exceeds_authorisation' };
    }

    intent.captured = true;
    return { ok: true, capturedAmount: amount };
  }

  async release(paymentIntentId: string): Promise<RefundResult> {
    const intent = this.intents.get(paymentIntentId);
    if (intent === undefined) return { ok: false, reason: 'not_captured' };
    this.intents.delete(paymentIntentId);
    return { ok: true };
  }

  /**
   * `_amount` is accepted but unused: partial refunds are real (a dispute
   * settled at half the price), and the interface must carry the amount so the
   * eventual PSP implementation can honour it. The stub only tracks whether a
   * refund happened.
   */
  async refund(paymentIntentId: string, _amount: SarAmount): Promise<RefundResult> {
    const intent = this.intents.get(paymentIntentId);
    if (intent === undefined || !intent.captured) return { ok: false, reason: 'not_captured' };
    if (intent.refunded) return { ok: false, reason: 'already_refunded' };

    intent.refunded = true;
    return { ok: true };
  }
}

/** String compare on fixed 2dp SAR values, via integer halalas. */
function compareAmounts(a: SarAmount, b: SarAmount): number {
  const toHalalas = (value: SarAmount) => {
    const [whole = '0', fraction = '00'] = value.replace('-', '').split('.');
    const magnitude = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return value.startsWith('-') ? -magnitude : magnitude;
  };
  return toHalalas(a) - toHalalas(b);
}

export const paymentProvider: PaymentProvider = new DevPaymentProvider();
