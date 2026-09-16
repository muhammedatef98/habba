/**
 * The shadowing rule, against `applicable_rules` (0029).
 *
 * The console draws a red "this rule never runs" on the strength of this
 * function. Two ways to be wrong and both are costly: miss a dead rule and the
 * screen goes on hiding the thing it was built to show, or flag a live one and
 * an operator switches off a rule that was working.
 *
 * The cases below are the SQL's ORDER BY, read back as behaviour.
 */

import { describe, expect, test } from 'vitest';
import { shadowedRules, type ShadowCandidate } from './maintenance-shadow.js';

const rule = (over: Partial<ShadowCandidate> & { id: string }): ShadowCandidate => ({
  serviceId: 'svc-oil',
  makeId: null,
  modelId: null,
  nameAr: over.id,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('shadowedRules', () => {
  test('one rule for a service shadows nothing', () => {
    expect(shadowedRules([rule({ id: 'a' })]).size).toBe(0);
  });

  // ⚠️ The case the whole screen exists for: an operator "corrects" an interval
  // by adding a second generic rule, and the database keeps using the first.
  test('a second rule in the same scope is dead, and the OLDER one wins', () => {
    const result = shadowedRules([
      rule({ id: 'old', nameAr: 'الأصلية', createdAt: '2026-01-01T00:00:00.000Z' }),
      rule({ id: 'new', nameAr: 'المصحّحة', createdAt: '2026-06-01T00:00:00.000Z' }),
    ]);

    expect(result.get('new')).toBe('الأصلية');
    expect(result.has('old')).toBe(false);
  });

  test('order of input does not change the answer', () => {
    const rows = [
      rule({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z' }),
      rule({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];

    expect(shadowedRules(rows).has('new')).toBe(true);
    expect(shadowedRules([...rows].reverse()).has('new')).toBe(true);
  });

  // ⚠️ The false positive that would make the warning untrustworthy. A make
  // rule beats the generic rule FOR THAT MAKE only; the generic rule still
  // fires for every other car, so it is not dead and must not be flagged.
  test('a make rule does not shadow the generic rule it outranks', () => {
    const result = shadowedRules([
      rule({ id: 'generic' }),
      rule({ id: 'toyota', makeId: 'make-toyota' }),
    ]);

    expect(result.size).toBe(0);
  });

  test('nor does a model rule shadow the make rule above it', () => {
    const result = shadowedRules([
      rule({ id: 'toyota', makeId: 'make-toyota' }),
      rule({ id: 'camry', makeId: 'make-toyota', modelId: 'model-camry' }),
    ]);

    expect(result.size).toBe(0);
  });

  test('two rules for the same make ARE in the same scope', () => {
    const result = shadowedRules([
      rule({ id: 'first', makeId: 'make-toyota', createdAt: '2026-01-01T00:00:00.000Z' }),
      rule({ id: 'second', makeId: 'make-toyota', createdAt: '2026-02-01T00:00:00.000Z' }),
    ]);

    expect(result.get('second')).toBe('first');
  });

  test('different services never compete', () => {
    const result = shadowedRules([
      rule({ id: 'oil', serviceId: 'svc-oil' }),
      rule({ id: 'belt', serviceId: 'svc-belt' }),
    ]);

    expect(result.size).toBe(0);
  });

  // ⚠️ Deactivating the winner is how an operator fixes a shadowed rule, so an
  // inactive row must stop shadowing the moment it is switched off.
  test('an inactive rule shadows nothing', () => {
    const result = shadowedRules([
      rule({ id: 'old', isActive: false, createdAt: '2026-01-01T00:00:00.000Z' }),
      rule({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z' }),
    ]);

    expect(result.size).toBe(0);
  });

  test('and an inactive rule is not itself reported as shadowed', () => {
    const result = shadowedRules([
      rule({ id: 'live', createdAt: '2026-01-01T00:00:00.000Z' }),
      rule({ id: 'retired', isActive: false, createdAt: '2026-06-01T00:00:00.000Z' }),
    ]);

    expect(result.size).toBe(0);
  });

  test('three in one scope leaves only the oldest standing', () => {
    const result = shadowedRules([
      rule({ id: 'a', nameAr: 'الأولى', createdAt: '2026-01-01T00:00:00.000Z' }),
      rule({ id: 'b', createdAt: '2026-02-01T00:00:00.000Z' }),
      rule({ id: 'c', createdAt: '2026-03-01T00:00:00.000Z' }),
    ]);

    expect(result.get('b')).toBe('الأولى');
    expect(result.get('c')).toBe('الأولى');
    expect(result.has('a')).toBe(false);
  });

  test('identical timestamps still resolve to one winner', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const result = shadowedRules([
      rule({ id: 'b', createdAt: at }),
      rule({ id: 'a', createdAt: at }),
    ]);

    expect(result.size).toBe(1);
    expect(result.has('b')).toBe(true);
  });
});
