/**
 * How money reads in the UI, as opposed to how it is stored.
 *
 * `SarAmount` is a branded fixed-2dp string (ADR-0007) because that is what
 * arithmetic and ZATCA need. It is not what a price list should say: a
 * catalogue of "220.00 / 380.00 / 450.00" spends a third of its numerals on
 * two zeros that carry no information, and the eye has to skip them to compare
 * the figures that matter.
 *
 * So trailing hundredths are dropped ONLY when they are both zero. 22.43 keeps
 * its halalas, 22.40 keeps them too — dropping a single trailing zero would
 * turn 22.40 into 22.4, which reads as a truncation rather than a price.
 *
 * Never use this for an invoice line or anything a customer might reconcile
 * against a bank statement; those want the stored form exactly.
 */

import type { SarAmount } from '@habba/core';

export function formatSarDisplay(amount: SarAmount): string {
  return amount.endsWith('.00') ? amount.slice(0, -3) : amount;
}
