/**
 * THE PLUG POINT for card payments: Moyasar's card form.
 *
 * Everything else about live payments is built — the `payments` Edge
 * Function verifies what this returns with the secret key, the database
 * records the hold only from there (0077), captures, voids and refunds run
 * from a queue. What is left is the one part that needs Moyasar's own UI on
 * the phone, which cannot be written without their SDK and a development
 * build (it is native code; Expo Go does not carry it).
 *
 * To connect it:
 *
 *   1. Add Moyasar's React Native SDK (see docs.moyasar.com → Mobile SDKs)
 *      and make a development build (`pnpm --filter @habba/mobile build:dev`).
 *   2. Replace `collectCardPayment` below with a function that shows the
 *      form and resolves when it closes. Configure it with:
 *        - `publishableKey`             — `request.publishableKey`
 *        - `amount`                     — `request.amountHalalas` (integer)
 *        - `currency`                   — 'SAR'
 *        - `description`                — `request.description`
 *        - `metadata: { order_id }`     — `request.orderId`. REQUIRED: the
 *                                         server refuses a payment made for
 *                                         any other order.
 *        - `manual: true`               — authorise only. The money is taken
 *                                         when the customer confirms the job.
 *        - networks: mada, visa, mastercard; Apple Pay with your merchant id.
 *   3. Set EXPO_PUBLIC_MOYASAR_PUBLISHABLE_KEY, deploy the `payments`
 *      function with MOYASAR_SECRET_KEY, and switch `payments_gateway` to
 *      `moyasar` in the console. docs/GO-LIVE.md has the whole list.
 *
 * Until then this is null, and a build configured for Moyasar refuses to
 * take a payment ('card_form_unavailable') rather than pretending to.
 */

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

export const collectCardPayment: CardFormCollector | null = null;
