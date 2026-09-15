/**
 * The console's session rule.
 *
 * Amendment B (§5.1.6) states it in one sentence — "Sessions expire after 8
 * hours. There is no 'remember me'." — and a rule nobody can test is a rule
 * nobody can rely on. `isSessionExpired` is pure precisely so this file can
 * exist without a clock or a Supabase project.
 */

import { describe, expect, test } from 'vitest';
import { isSessionExpired, OPS_SESSION_MAX_SECONDS } from './ops-session.js';

const NOW_MS = Date.UTC(2026, 8, 15, 12, 0, 0);
const nowSeconds = NOW_MS / 1000;

describe('isSessionExpired', () => {
  test('a session signed in moments ago is live', () => {
    expect(isSessionExpired(nowSeconds - 60, NOW_MS)).toBe(false);
  });

  test('seven hours in is still live', () => {
    expect(isSessionExpired(nowSeconds - 7 * 3600, NOW_MS)).toBe(false);
  });

  test('past eight hours it is not', () => {
    expect(isSessionExpired(nowSeconds - OPS_SESSION_MAX_SECONDS - 1, NOW_MS)).toBe(true);
  });

  // ⚠️ The boundary is the requirement, so it is asserted rather than assumed.
  test('exactly eight hours has not expired yet', () => {
    expect(isSessionExpired(nowSeconds - OPS_SESSION_MAX_SECONDS, NOW_MS)).toBe(false);
  });

  // A console left open overnight is the case this exists for.
  test('a session from yesterday is expired', () => {
    expect(isSessionExpired(nowSeconds - 20 * 3600, NOW_MS)).toBe(true);
  });

  /**
   * ⚠️ Absent means expired, not young.
   *
   * The tempting default is `false` — "we don't know, so carry on" — and it is
   * the wrong way round for a console that can approve providers and read every
   * order. A session we cannot date is a session we cannot vouch for.
   */
  test('a session with no issue time is treated as expired', () => {
    expect(isSessionExpired(undefined, NOW_MS)).toBe(true);
  });

  test('the limit is the eight hours Amendment B specifies', () => {
    expect(OPS_SESSION_MAX_SECONDS).toBe(8 * 60 * 60);
  });
});
