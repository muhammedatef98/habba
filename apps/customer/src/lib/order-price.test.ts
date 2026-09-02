import { describe, expect, it } from 'vitest';
import { sarOrThrow } from '@habba/core';
import { agreedTotal, isFullyCosted } from './order-price.js';
import type { Order } from '@/data/types';

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
    ...fields,
  };
}

describe('agreedTotal', () => {
  it('falls back to the quote while the job is still being worked', () => {
    // The failure this fixes: `total_amount` is null until the job is costed,
    // so the tracking screen rendered a labelled total with nothing in it.
    expect(agreedTotal(order({ quotedAmount: sarOrThrow('150.00') }))).toBe('150.00');
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
