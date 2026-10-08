import { describe, expect, it } from 'vitest';
import { chatOpen, refusalOf, sideOf } from './chat.js';

describe('order chat', () => {
  it('is open from acceptance until hand-back, as the server allows it', () => {
    expect(chatOpen('accepted')).toBe(true);
    expect(chatOpen('in_progress')).toBe(true);
    expect(chatOpen('awaiting_approval')).toBe(true);
    expect(chatOpen('searching')).toBe(false);
    expect(chatOpen('completed')).toBe(false);
    expect(chatOpen('cancelled')).toBe(false);
  });

  it("reads the server's refusal, and nothing else as one", () => {
    expect(refusalOf(new Error('chat:closed'))).toBe('closed');
    expect(refusalOf(new Error('chat:rate'))).toBe('rate');
    expect(refusalOf(new Error('chat:not_party'))).toBe('not_party');
    expect(refusalOf(new Error('Network request failed'))).toBeNull();
  });

  it('treats an unknown side as the customer', () => {
    expect(sideOf('provider')).toBe('provider');
    expect(sideOf(['provider'])).toBe('provider');
    expect(sideOf('admin')).toBe('customer');
    expect(sideOf(undefined)).toBe('customer');
  });
});
