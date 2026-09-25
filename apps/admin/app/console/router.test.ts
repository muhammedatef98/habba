import { describe, expect, test } from 'vitest';
import { hrefFor, parseHash } from './router';

describe('console routes', () => {
  test('a section and an id round-trip through the hash', () => {
    expect(parseHash(hrefFor('orders', 'ord-1'))).toEqual({ section: 'orders', id: 'ord-1' });
    expect(parseHash(hrefFor('settings'))).toEqual({ section: 'settings', id: null });
  });

  test('anything unknown lands on the dashboard rather than a blank page', () => {
    expect(parseHash('#/nowhere/x')).toEqual({ section: 'dashboard', id: 'x' });
    expect(parseHash('')).toEqual({ section: 'dashboard', id: null });
  });
});
