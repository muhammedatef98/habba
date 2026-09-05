/**
 * What "the agreed price" means at each point in a job.
 *
 * `orders.total_amount` is only written once the job is costed — parts, labour
 * and VAT settled — which for an emergency is at completion. Before then it is
 * null, and four tracking screens were reading it directly with a `?? '—'`
 * fallback. So a customer watching a technician work saw "الإجمالي المتفق
 * عليه — ر.س": a labelled total with nothing in it, on the screen where
 * knowing the number matters most.
 *
 * The agreed price before costing is `quoted_amount`, which the emergency
 * flow sets from the central catalogue at creation (§11 fixes emergency prices
 * centrally, so it is a promise, not an estimate). Once `total_amount` exists
 * it supersedes it, because by then it includes approved parts the quote did
 * not.
 *
 * Null only when there is genuinely no agreed number yet — an order still
 * searching. The caller renders its own reduced state; this does not invent
 * one.
 */

import type { Order } from '@/features/shared/data/types';
import type { SarAmount } from '@habba/core';

export function agreedTotal(order: Order): SarAmount | null {
  return order.totalAmount ?? order.quotedAmount;
}

/** True once parts and VAT have been settled — i.e. the breakdown is real. */
export function isFullyCosted(order: Order): boolean {
  return order.totalAmount !== null;
}
