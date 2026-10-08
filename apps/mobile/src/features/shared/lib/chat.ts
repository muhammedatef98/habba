/**
 * Order messages (0101): when the thread is open, and what a refusal means.
 *
 * The server is the one that decides — `send_order_message` checks the
 * party, the status and the rate itself. This mirrors the status list only
 * so the app can stop offering a box that the server would refuse.
 */

import type { OrderStatus } from '@habba/core';
import type { OrderMessage, OrderMessageRefusal } from '@/features/shared/data/types';

/** From acceptance until hand-back; the same list `send_order_message` allows. */
export const CHAT_OPEN_STATUSES: readonly OrderStatus[] = [
  'accepted',
  'checked_in',
  'en_route',
  'arrived',
  'in_progress',
  'awaiting_approval',
];

export function chatOpen(status: OrderStatus): boolean {
  return CHAT_OPEN_STATUSES.includes(status);
}

export const CHAT_MAX_LENGTH = 1000;

/** The refusal named in an error the repository threw, or null for a failure to reach the server. */
export function refusalOf(cause: unknown): OrderMessageRefusal | null {
  const message = cause instanceof Error ? cause.message : String(cause);
  switch (message) {
    case 'chat:closed':
      return 'closed';
    case 'chat:length':
      return 'length';
    case 'chat:rate':
      return 'rate';
    case 'chat:not_party':
      return 'not_party';
    default:
      return null;
  }
}

/** The side of the order a route param names; anything else reads as the customer. */
export function sideOf(value: string | string[] | undefined): OrderMessage['side'] {
  const side = Array.isArray(value) ? value[0] : value;
  return side === 'provider' ? 'provider' : 'customer';
}
