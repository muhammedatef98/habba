import { describe, expect, it } from 'vitest';
import { invoiceFileName, renderInvoiceHtml, type InvoiceDocument } from './invoice.js';

const invoice: InvoiceDocument = {
  invoiceNumber: 'HB-INV-2026-000123',
  issuedAt: '2026-09-24T21:30:00Z',
  invoiceType: 'simplified',
  seller: {
    legalNameAr: 'شركة هبّة للتقنية',
    vatNumber: '300000000000003',
    crNumber: '1010000000',
  },
  orderNumber: 'HB-2026-000412',
  lines: [
    { descriptionAr: 'أجرة الخدمة — ونش/سحب', quantity: 1, net: '150.00' },
    { descriptionAr: 'بطارية 70 أمبير', quantity: 1, net: '320.00' },
  ],
  net: '470.00',
  vat: '70.50',
  vatRate: 0.15,
  total: '540.50',
  qrBase64: 'ARFYYWJiYSBUZWNobm9sb2d5AgszMDAwMDAwMDAwMDA=',
};

describe('renderInvoiceHtml', () => {
  const html = renderInvoiceHtml(invoice);

  it('is an Arabic, right-to-left simplified tax invoice', () => {
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('فاتورة ضريبية مبسطة');
  });

  it('states what ZATCA requires on the page: seller, VAT number, date, VAT and total', () => {
    expect(html).toContain('شركة هبّة للتقنية');
    expect(html).toContain('300000000000003');
    expect(html).toContain('HB-INV-2026-000123');
    expect(html).toContain('70.50');
    expect(html).toContain('540.50');
    expect(html).toContain('15%');
  });

  it('gives the issue time in Riyadh', () => {
    // 21:30 UTC is 00:30 the next day in Riyadh.
    expect(html).toContain('2026-09-25 00:30');
  });

  it('carries the QR as an inline SVG, with no request to any service', () => {
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/(src|href)="https?:/);
  });

  it('lists every line with its amount before VAT', () => {
    expect(html).toContain('بطارية 70 أمبير');
    expect(html).toContain('320.00');
  });

  it('escapes what it is given', () => {
    const hostile = renderInvoiceHtml({
      ...invoice,
      lines: [{ descriptionAr: '<script>x</script>', quantity: 1, net: '1.00' }],
    });
    expect(hostile).not.toContain('<script>x');
  });
});

describe('credit notes (0096)', () => {
  const credited = renderInvoiceHtml({
    ...invoice,
    creditNotes: [
      {
        creditNoteNumber: 'HB-CRN-2026-000007',
        issuedAt: '2026-09-27T09:00:00Z',
        reasonAr: 'استرداد بعد مراجعة شكوى: <b>تأخير</b>',
        net: '43.48',
        vat: '6.52',
        total: '50.00',
        qrBase64: 'ARFYYWJiYSBUZWNobm9sb2d5AgszMDAwMDAwMDAwMDA=',
      },
    ],
  });

  it('prints nothing extra when nothing was refunded', () => {
    expect(renderInvoiceHtml(invoice)).not.toContain('<article class="credit-note"');
    expect(renderInvoiceHtml({ ...invoice, creditNotes: [] })).not.toContain(
      '<article class="credit-note"',
    );
  });

  it('adds each as its own page that names the invoice it credits', () => {
    expect(credited).toContain('إشعار دائن مبسّط');
    expect(credited).toContain('HB-CRN-2026-000007');
    expect(credited.split('<article class="credit-note"')[1]).toContain('HB-INV-2026-000123');
    expect(credited).toContain('page-break-before');
  });

  it('with its amounts, its reason escaped, its own QR, and the time in Riyadh', () => {
    const page = credited.split('<article class="credit-note"')[1] ?? '';
    expect(page).toContain('6.52');
    expect(page).toContain('50.00');
    expect(page).toContain('&lt;b&gt;تأخير');
    expect(page).toContain('<svg');
    expect(page).toContain('2026-09-27 12:00');
  });
});

describe('invoiceFileName', () => {
  it('names the file by its invoice number', () => {
    expect(invoiceFileName(invoice)).toBe('فاتورة-HB-INV-2026-000123.pdf');
  });
});
