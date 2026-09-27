/**
 * Card payments through Moyasar, on the phone.
 *
 * The customer types the card into Habba's own form (<CardFormHost>), and
 * the phone creates the payment directly with Moyasar using the PUBLISHABLE
 * key: authorise only (`manual`), 3-D Secure on, `metadata.order_id` set
 * (@habba/core payments/moyasar-card.ts). The card number goes from the
 * phone to Moyasar and nowhere else — not to Habba's servers, not to a log.
 *
 * 3-D Secure opens in an in-app browser; Moyasar sends it back to the
 * console's /pay/return page, which hands the result to the app's own link
 * and closes the browser.
 *
 * What comes back is only a payment id. The `payments` Edge Function then
 * fetches that payment with the SECRET key and records the hold only if it
 * is authorised, for this order, for the exact amount. Nothing the phone
 * says about a payment is believed on its own.
 */

import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  createCardPaymentRequest,
  readCreatedPayment,
  validateCard,
  type CardField,
  type CardInput,
} from '@habba/core';
import { useCardForm } from '@/features/shared/state/card-form';

export interface CardPaymentRequest {
  readonly publishableKey: string;
  readonly orderId: string;
  readonly amountHalalas: number;
  readonly description: string;
}

export type CardPaymentResult =
  | { readonly status: 'authorised'; readonly paymentId: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

export type CardFormCollector = (request: CardPaymentRequest) => Promise<CardPaymentResult>;

/** The form's answer to `authorise`: shown by <CardFormHost>, settled by it. */
export const collectCardPayment: CardFormCollector = (request) =>
  useCardForm.getState().open(request);

/** Where Moyasar returns after 3-D Secure (the console's /pay/return page). */
function returnPage(): string {
  const configured = (Constants.expoConfig?.extra as { paymentReturnUrl?: string } | undefined)
    ?.paymentReturnUrl;
  return configured !== undefined && configured.trim() !== ''
    ? configured.trim()
    : 'https://habba-admin.vercel.app/pay/return';
}

export type CardAttempt =
  | { readonly status: 'authorised'; readonly paymentId: string }
  | { readonly status: 'invalid'; readonly fields: readonly CardField[] }
  | { readonly status: 'declined'; readonly message: string }
  | { readonly status: 'unverified' }
  | { readonly status: 'network' };

/**
 * One attempt with the card as typed. The form stays open on anything but
 * `authorised`, so the customer can fix a typo or try another card.
 */
export async function payWithCard(
  request: CardPaymentRequest,
  input: CardInput,
): Promise<CardAttempt> {
  const checked = validateCard(input);
  if (!checked.ok) return { status: 'invalid', fields: checked.errors };

  const appLink = Linking.createURL('pay-return');
  const callbackUrl = `${returnPage()}?to=${encodeURIComponent(appLink)}`;

  let created;
  try {
    const spec = createCardPaymentRequest(
      request.publishableKey,
      {
        orderId: request.orderId,
        amountHalalas: request.amountHalalas,
        description: request.description,
        callbackUrl,
      },
      checked.card,
    );
    const response = await fetch(spec.url, spec.init);
    created = readCreatedPayment(response.status, await response.text());
  } catch {
    // Not the caught error: it can carry the request, and the request
    // carries the card.
    return { status: 'network' };
  }

  if (created.kind === 'failed') return { status: 'declined', message: created.message };
  if (created.kind === 'authorised') return { status: 'authorised', paymentId: created.paymentId };

  const session = await WebBrowser.openAuthSessionAsync(created.url, appLink);
  if (session.type !== 'success') return { status: 'unverified' };

  const returned = Linking.parse(session.url).queryParams ?? {};
  if (returned['status'] === 'authorized') {
    return { status: 'authorised', paymentId: created.paymentId };
  }
  const message = returned['message'];
  return { status: 'declined', message: typeof message === 'string' ? message : '' };
}
