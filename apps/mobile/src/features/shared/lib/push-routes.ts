/**
 * Where a notification leads, and what it makes stale.
 *
 * The payload's `route` is written by the server (0066), but it is still
 * input: it arrives from outside the app, through Apple or Google. So it is
 * matched against the handful of places a notification may lead and nothing
 * else — an unknown route opens nothing rather than whatever it names.
 *
 * Each target also says which side of the app it belongs to. A technician who
 * is browsing their own car in customer mode and taps a job offer has to land
 * in provider mode, or the job screen's group guard sends them home and the
 * offer is gone before they see it.
 */

import type { AppMode } from '@/features/shared/state/mode';

export type PushPathname = '/tracking' | '/quote' | '/vehicles' | '/job' | '/';

export interface PushTarget {
  readonly mode: AppMode;
  readonly pathname: PushPathname;
  readonly params: Readonly<Record<string, string>>;
  /** Query keys this news makes stale, so an open screen updates now, not at its next poll. */
  readonly refresh: readonly (readonly string[])[];
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

export function targetFor(data: unknown): PushTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const payload = data as Record<string, unknown>;
  const route = stringField(payload, 'route');
  const id = stringField(payload, 'id');
  const validId = id !== null && ID.test(id) ? id : null;

  switch (route) {
    case '/tracking':
      return validId === null
        ? null
        : {
            mode: 'customer',
            pathname: '/tracking',
            params: { id: validId },
            refresh: [['order', validId], ['order-progress', validId], ['recent-orders']],
          };
    case '/quote':
      return validId === null
        ? null
        : {
            mode: 'customer',
            pathname: '/quote',
            params: { id: validId },
            refresh: [
              ['order-parts', validId],
              ['order', validId],
            ],
          };
    case '/vehicles':
      return { mode: 'customer', pathname: '/vehicles', params: {}, refresh: [['vehicles']] };
    case '/job':
      return validId === null
        ? null
        : {
            mode: 'provider',
            pathname: '/job',
            params: { id: validId },
            refresh: [['job', validId], ['open-jobs'], ['my-jobs']],
          };
    case '/':
      // The provider's home — the shift screen — after a job fell through.
      return { mode: 'provider', pathname: '/', params: {}, refresh: [['open-jobs'], ['my-jobs']] };
    default:
      return null;
  }
}
