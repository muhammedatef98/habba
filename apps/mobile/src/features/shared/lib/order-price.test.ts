import { describe, expect, it } from 'vitest';
import { sarOrThrow } from '@habba/core';
import { agreedTotal, isFullyCosted, priceWithVat } from './order-price.js';
import type { Order } from '@/features/shared/data/types';

function order(fields: Partial<Order>): Order {
  return {
    id: 'order-1',
    status: 'in_progress',
    fulfilmentMode: 'mobile_ondemand',
    vehicleId: 'veh-1',
    serviceId: 'svc-towing',
    providerId: 'prov-1',
    serviceAddressAr: null,
    problemDescription: null,
    quotedAmount: null,
    partsAmount: null,
    labourAmount: null,
    vatAmount: null,
    totalAmount: null,
    escrowStatus: 'authorised',
    completionMedia: [],
    warrantyDays: null,
    scheduledFor: null,
    ...fields,
  };
}

describe('agreedTotal', () => {
  it('falls back to the quote while the job is still being worked', () => {
    // The failure this fixes: `total_amount` is null until the job is costed,
    // so the tracking screen rendered a labelled total with nothing in it.
    // With VAT: the quote is before tax, and the customer agreed to — and has
    // held on their card — the amount including it.
    expect(agreedTotal(order({ quotedAmount: sarOrThrow('150.00') }))).toBe('172.50');
  });

  it('prefers the settled total once it exists — it includes approved parts', () => {
    expect(
      agreedTotal(order({ quotedAmount: sarOrThrow('150.00'), totalAmount: sarOrThrow('540.50') })),
    ).toBe('540.50');
  });

  it('is null when there is genuinely no agreed number yet', () => {
    expect(agreedTotal(order({ status: 'searching' }))).toBeNull();
  });
});

describe('isFullyCosted', () => {
  it('is false while only a quote exists', () => {
    expect(isFullyCosted(order({ quotedAmount: sarOrThrow('150.00') }))).toBe(false);
  });

  it('is true once the total is settled', () => {
    expect(isFullyCosted(order({ totalAmount: sarOrThrow('540.50') }))).toBe(true);
  });
});

describe('priceWithVat', () => {
  it('is what the customer pays for a catalogue price, VAT included', () => {
    expect(priceWithVat(sarOrThrow('120.00'))).toBe('138.00');
  });

  it('rounds VAT half-up to the halala, as the server bills it', () => {
    // 99.99 × 0.15 = 14.9985 → 15.00, the same rule as round(…, 2) in 0065.
    expect(priceWithVat(sarOrThrow('99.99'))).toBe('114.99');
  });
});
