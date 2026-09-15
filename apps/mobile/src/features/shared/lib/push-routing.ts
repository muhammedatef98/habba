/**
 * Where a tapped notification should land.
 *
 * ⚠️ Deliberately its own file, importing nothing.
 *
 * `push.ts` reaches `expo-notifications` and `react-native`, neither of which
 * Vitest can parse — so anything living beside the provider instance is
 * untestable in this repo's setup. This is the half worth testing: it runs on a
 * cold start, before any screen exists, on a payload handed over by the
 * operating system.
 */

export interface PushDestination {
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
  /**
   * The mode the destination requires, or null if it works in either.
   *
   * Part of the answer, not an afterthought. A job offer belongs to the
   * `(provider)` route group, and a technician whose last session was on the
   * customer side would otherwise be redirected straight back out of it by
   * `(provider)/_layout.tsx` — the tap would appear to do nothing at all.
   */
  readonly requiresMode: 'customer' | 'provider' | null;
}

/**
 * Payloads are built by `enqueue_notification` in 0065, and treated as
 * untrusted anyway: a malformed one must produce null rather than a throw,
 * because a throw here is a crash before the first frame on a device we cannot
 * reproduce.
 */
export function destinationFor(data: unknown): PushDestination | null {
  if (typeof data !== 'object' || data === null) return null;

  const payload = data as Record<string, unknown>;
  const kind = payload['kind'];
  const orderId = payload['orderId'];

  if (typeof orderId !== 'string' || orderId === '') return null;

  if (kind === 'job_offer') {
    return { pathname: '/job', params: { id: orderId }, requiresMode: 'provider' };
  }

  if (kind === 'order') {
    return { pathname: '/tracking', params: { id: orderId }, requiresMode: 'customer' };
  }

  // An unrecognised kind is a newer server talking to an older app. Doing
  // nothing is right: guessing a route would open an arbitrary screen with an
  // id that means something else.
  return null;
}
