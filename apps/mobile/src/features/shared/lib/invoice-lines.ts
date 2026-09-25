/**
 * The lines of a tax invoice, from the order it was issued for.
 *
 * `zatca_invoices` snapshots the totals (net, VAT, total) but not the lines;
 * the order holds those — the labour, and each part the customer approved
 * (0067: a declined part is never billed). Line nets are computed in whole
 * halalas, never in floating riyals (§2.5), and only for display: the totals
 * printed under them are the invoice's own.
 */

import type { InvoiceLine } from '@habba/core';

export interface BilledPart {
  readonly nameAr: string;
  readonly quantity: number;
  /** 2dp string, before VAT. */
  readonly unitPrice: string;
  readonly approved: boolean;
}

function halalas(amount: string): number {
  const [whole = '0', fraction = ''] = amount.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

function riyals(total: number): string {
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, '0')}`;
}

export function invoiceLines(
  labourLabelAr: string,
  labourAmount: string | null,
  parts: readonly BilledPart[],
): readonly InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  if (labourAmount !== null && halalas(labourAmount) > 0) {
    lines.push({ descriptionAr: labourLabelAr, quantity: 1, net: riyals(halalas(labourAmount)) });
  }
  for (const part of parts) {
    if (!part.approved) continue;
    lines.push({
      descriptionAr: part.nameAr,
      quantity: part.quantity,
      net: riyals(halalas(part.unitPrice) * part.quantity),
    });
  }
  return lines;
}
