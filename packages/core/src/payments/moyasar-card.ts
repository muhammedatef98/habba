/**
 * The card side of Moyasar: what the phone sends when a customer pays.
 *
 * The phone creates the payment itself, with the PUBLISHABLE key — the key
 * Moyasar issues for exactly this, which can start a payment and do nothing
 * else. The card number goes from the phone to Moyasar over TLS and nowhere
 * else: not to Habba's database, not to the Edge Function, not to a log.
 *
 *   1. `validateCard` catches typos before anything is sent.
 *   2. `createCardPaymentRequest` builds the request: `manual` so the card is
 *      authorised and not charged (the money is taken when the customer
 *      confirms the job), `3ds` on, and `metadata.order_id` so the server can
 *      tell which order a payment was made for.
 *   3. `readCreatedPayment` reads Moyasar's answer: authorised already, or a
 *      3-D Secure page the customer must pass through first.
 *   4. Either way the app then hands the payment id to the `payments` Edge
 *      Function, which fetches it with the SECRET key and records the hold
 *      only if it is authorised, for this order, for the exact amount
 *      (`checkAuthorisation` in moyasar.ts). Nothing here is trusted on its
 *      own word.
 *
 * Pure, like moyasar.ts: nothing here sends anything.
 */

import { MOYASAR_API } from './moyasar.js';

export interface CardInput {
  readonly name: string;
  readonly number: string;
  /** As typed: "MM/YY", "MM/YYYY", or four digits. */
  readonly expiry: string;
  readonly cvc: string;
}

export type CardField = 'name' | 'number' | 'expiry' | 'cvc';

export interface NormalisedCard {
  readonly name: string;
  readonly number: string;
  readonly month: number;
  readonly year: number;
  readonly cvc: string;
}

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

function latinDigits(value: string): string {
  return value.replace(EASTERN_DIGITS, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** ISO/IEC 7812 check digit. mada, Visa and Mastercard all carry one. */
export function luhnValid(number: string): boolean {
  if (!/^[0-9]{12,19}$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let digit = number.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * The card as Moyasar wants it, or the fields that are wrong. `now` is
 * injectable so the expiry rule is testable.
 */
export function validateCard(
  input: CardInput,
  now: Date = new Date(),
):
  | { readonly ok: true; readonly card: NormalisedCard }
  | { readonly ok: false; readonly errors: readonly CardField[] } {
  const errors: CardField[] = [];

  const name = input.name.trim().replace(/\s+/g, ' ');
  // Moyasar wants the name as printed: at least a first and a last name.
  if (!/^\S+\s+\S+/.test(name) || name.length > 100) errors.push('name');

  const number = latinDigits(input.number).replace(/[\s-]/g, '');
  if (!luhnValid(number)) errors.push('number');

  const expiry = latinDigits(input.expiry).replace(/\s/g, '');
  const match = /^(\d{1,2})\/?(\d{2}|\d{4})$/.exec(expiry);
  let month = 0;
  let year = 0;
  if (match === null) {
    errors.push('expiry');
  } else {
    month = Number(match[1]);
    year = Number(match[2]!.length === 2 ? `20${match[2]}` : match[2]);
    const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
    const cardMonth = year * 12 + (month - 1);
    if (month < 1 || month > 12 || cardMonth < thisMonth || year > now.getUTCFullYear() + 20) {
      errors.push('expiry');
    }
  }

  const cvc = latinDigits(input.cvc).trim();
  if (!/^[0-9]{3,4}$/.test(cvc)) errors.push('cvc');

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, card: { name, number, month, year, cvc } };
}

export interface CardPaymentOrder {
  readonly orderId: string;
  /** Integer halalas. */
  readonly amountHalalas: number;
  readonly description: string;
  /** Where Moyasar sends the customer after 3-D Secure. */
  readonly callbackUrl: string;
}

export interface MoyasarCreateRequest {
  readonly url: string;
  readonly init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  };
}

export function createCardPaymentRequest(
  publishableKey: string,
  order: CardPaymentOrder,
  card: NormalisedCard,
): MoyasarCreateRequest {
  // A secret key here would put the key that moves money into every phone.
  if (!/^pk_(test|live)_/.test(publishableKey)) {
    throw new Error('Moyasar: a publishable key (pk_…) is required on the phone');
  }
  if (!Number.isInteger(order.amountHalalas) || order.amountHalalas < 100) {
    throw new Error('Moyasar: amount must be whole halalas, at least 1 SAR');
  }

  return {
    url: `${MOYASAR_API}/payments`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${publishableKey}:`)}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: order.amountHalalas,
        currency: 'SAR',
        description: order.description,
        callback_url: order.callbackUrl,
        metadata: { order_id: order.orderId },
        source: {
          type: 'creditcard',
          name: card.name,
          number: card.number,
          month: card.month,
          year: card.year,
          cvc: card.cvc,
          manual: true,
          '3ds': true,
        },
      }),
    },
  };
}

export type CreatedPayment =
  | { readonly kind: 'authorised'; readonly paymentId: string }
  | { readonly kind: 'needs_3ds'; readonly paymentId: string; readonly url: string }
  | { readonly kind: 'failed'; readonly message: string };

interface CreatedBody {
  id?: unknown;
  status?: unknown;
  message?: unknown;
  source?: { transaction_url?: unknown; message?: unknown } | null;
}

/**
 * Moyasar's answer to a create. Only the shapes it documents count; anything
 * else is a failure, never a pass. The message is Moyasar's own, safe to show
 * (it never contains the card number).
 */
export function readCreatedPayment(status: number, rawBody: string): CreatedPayment {
  let body: CreatedBody;
  try {
    body = JSON.parse(rawBody) as CreatedBody;
  } catch {
    return { kind: 'failed', message: `gateway_${status}` };
  }
  if (typeof body !== 'object' || body === null)
    return { kind: 'failed', message: `gateway_${status}` };

  const message =
    (typeof body.source?.message === 'string' && body.source.message) ||
    (typeof body.message === 'string' && body.message) ||
    `gateway_${status}`;
  if (status < 200 || status >= 300 || typeof body.id !== 'string')
    return { kind: 'failed', message };

  if (body.status === 'authorized') return { kind: 'authorised', paymentId: body.id };
  if (body.status === 'initiated' && typeof body.source?.transaction_url === 'string') {
    const url = body.source.transaction_url;
    // Only ever open Moyasar's own 3-D Secure pages.
    if (/^https:\/\/([a-z0-9-]+\.)*moyasar\.com\//i.test(url)) {
      return { kind: 'needs_3ds', paymentId: body.id, url };
    }
  }
  return { kind: 'failed', message };
}
