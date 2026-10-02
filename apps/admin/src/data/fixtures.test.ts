import { describe, expect, test } from 'vitest';
import { FixtureTransport } from './fixtures';
import type { OrderFile, OrderRow } from './types';

/**
 * The demo console must credit a refund the way 0096 does, or an operator
 * trying the refund flow locally sees a tax record the real one never shows.
 */
describe('credit notes in the demo console (0096)', () => {
  async function invoicedOrder(transport: FixtureTransport): Promise<OrderFile> {
    const rows = await transport.rpc<OrderRow[]>('ops_list_orders', { p_status: 'completed' });
    const row = rows.find((candidate) => (candidate.total_amount ?? 0) > 20);
    if (row === undefined) throw new Error('the seed has no completed order to refund');
    await transport.rpc('ops_issue_invoice', { p_order_id: row.id });
    return transport.rpc<OrderFile>('ops_order_detail', { p_order_id: row.id });
  }

  test('a partial refund, then the rest, reverses the invoice exactly', async () => {
    const transport = new FixtureTransport();
    const file = await invoicedOrder(transport);
    const id = file.order.id;
    const total = file.order.total_amount ?? 0;

    await transport.rpc('ops_open_dispute', { p_order_id: id, p_reason: 'فصلت البطارية' });
    await transport.rpc('ops_resolve_dispute', {
      p_order_id: id,
      p_resolution: 'partial_refund',
      p_refund_amount: 10,
      p_note: 'تعويض',
    });

    let after = await transport.rpc<OrderFile>('ops_order_detail', { p_order_id: id });
    const notes = after.credit_notes ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.total_amount).toBe(10);
    expect(notes[0]?.vat_amount).toBe(1.3);
    expect(notes[0]?.reason_ar).toContain('تعويض');

    await transport.rpc('ops_open_dispute', { p_order_id: id, p_reason: 'مرة أخرى' });
    await transport.rpc('ops_resolve_dispute', {
      p_order_id: id,
      p_resolution: 'full_refund',
      p_refund_amount: null,
      p_note: 'استرداد كامل',
    });

    after = await transport.rpc<OrderFile>('ops_order_detail', { p_order_id: id });
    const sum = (pick: (note: NonNullable<OrderFile['credit_notes']>[number]) => number) =>
      Math.round((after.credit_notes ?? []).reduce((acc, note) => acc + pick(note), 0) * 100) / 100;
    expect(sum((note) => note.total_amount)).toBe(total);
    expect(sum((note) => note.vat_amount)).toBe(after.order.vat_amount);
    expect(await transport.rpc<number>('ops_issue_credit_notes', { p_order_id: id })).toBe(0);
  });
});
