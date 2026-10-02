/**
 * Where a customer goes back to after Moyasar's 3-D Secure page.
 *
 * Moyasar sends the browser to a web address with the payment's id and
 * status appended (`callback_url`). The app cannot be that address, so the
 * app passes its own deep link as `to`, and /pay/return hands the result on
 * to it. Only the app's own schemes are followed: a return page that
 * redirected anywhere it was told to would be an open redirect with Habba's
 * name on it.
 */

const APP_SCHEMES = /^(habba|exp|exps):\/\//i;

export interface PaymentReturn {
  readonly id?: string | undefined;
  readonly status?: string | undefined;
  readonly message?: string | undefined;
}

export function appReturnUrl(to: string | undefined, result: PaymentReturn): string | null {
  if (to === undefined || !APP_SCHEMES.test(to) || to.length > 300) return null;

  const params = new URLSearchParams();
  // Only what the app reads, and only in the shapes it expects.
  if (result.id !== undefined && /^[A-Za-z0-9_-]{8,64}$/.test(result.id))
    params.set('id', result.id);
  if (result.status !== undefined && /^[a-z_]{2,20}$/.test(result.status)) {
    params.set('status', result.status);
  }
  if (result.message !== undefined) params.set('message', result.message.slice(0, 200));

  const query = params.toString();
  if (query === '') return to;
  return `${to}${to.includes('?') ? '&' : '?'}${query}`;
}
