import { describe, expect, it } from 'vitest';
import { invoiceLines } from './invoice-lines.js';

describe('invoiceLines', () => {
  it('lists the labour and each approved part, never a declined one', () => {
    const lines = invoiceLines('أجرة الخدمة', '150.00', [
      { nameAr: 'بطارية', quantity: 1, unitPrice: '320.00', approved: true },
      { nameAr: 'فلتر', quantity: 2, unitPrice: '45.50', approved: true },
      { nameAr: 'مرفوضة', quantity: 1, unitPrice: '99.00', approved: false },
    ]);
    expect(lines).toEqual([
      { descriptionAr: 'أجرة الخدمة', quantity: 1, net: '150.00' },
      { descriptionAr: 'بطارية', quantity: 1, net: '320.00' },
      { descriptionAr: 'فلتر', quantity: 2, net: '91.00' },
    ]);
  });

  it('multiplies in halalas, so 3 × 0.10 is 0.30 and not 0.30000000000000004', () => {
    expect(
      invoiceLines('x', null, [{ nameAr: 'p', quantity: 3, unitPrice: '0.10', approved: true }]),
    ).toEqual([{ descriptionAr: 'p', quantity: 3, net: '0.30' }]);
  });

  it('omits labour that was not charged', () => {
    expect(invoiceLines('x', '0.00', [])).toEqual([]);
    expect(invoiceLines('x', null, [])).toEqual([]);
  });
});
