/**
 * The flags, and what they refuse to be talked into.
 *
 * Both of these default to OFF, and the default is the whole point of each:
 * `ENABLE_PROVIDER_MODE` off means no national ID reaches a placeholder vault
 * (ADR-0017), and `DEV_APPROVE_PROVIDER` off means the dev build shows the
 * screens a real applicant sees instead of skipping past them.
 *
 * A flag that fails open is not a flag, so the interesting cases here are the
 * wrong answers — `'1'`, `'yes'`, `'TRUE'`, a missing `extra`, a thrown read.
 * Every one of them must leave the flag off.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import Constants from 'expo-constants';
import { isDevProviderApprovalEnabled, isProviderModeEnabled } from './flags.js';

/** The stub's `expoConfig.extra`, which is what a build's flags arrive in. */
function setExtra(extra: Record<string, unknown>): void {
  (Constants as unknown as { expoConfig: { extra: Record<string, unknown> } }).expoConfig.extra =
    extra;
}

describe('isProviderModeEnabled', () => {
  beforeEach(() => setExtra({}));

  test('off when the build configured nothing', () => {
    // The shipped state. `app.config.ts` leaves `extra` empty when the
    // variable is unset, and this is the shape the stub mirrors.
    expect(isProviderModeEnabled()).toBe(false);
  });

  test('on only for a real boolean true', () => {
    setExtra({ enableProviderMode: true });
    expect(isProviderModeEnabled()).toBe(true);
  });

  test.each([['true'], ['1'], ['yes'], ['TRUE'], [1], [{}]])(
    'stays off for %p, which is not true',
    (value) => {
      // `app.config.ts` compares the env var with `=== 'true'` before it ever
      // gets here, so anything that is not a boolean means a build wrote
      // something unexpected into `extra` — and guessing at intent is how a
      // KYC form opens by accident.
      setExtra({ enableProviderMode: value });
      expect(isProviderModeEnabled()).toBe(false);
    },
  );
});

describe('isDevProviderApprovalEnabled', () => {
  beforeEach(() => setExtra({}));

  test('off when the build configured nothing', () => {
    expect(isDevProviderApprovalEnabled()).toBe(false);
  });

  test('on only for a real boolean true', () => {
    setExtra({ devApproveProvider: true });
    expect(isDevProviderApprovalEnabled()).toBe(true);
  });

  test('is a separate decision from provider mode', () => {
    // Provider mode on does NOT approve anyone: the mode switcher is still
    // gated on a role the server granted, and the application still sits
    // pending. The two flags answer different questions and neither implies
    // the other.
    setExtra({ enableProviderMode: true });
    expect(isDevProviderApprovalEnabled()).toBe(false);

    setExtra({ devApproveProvider: true });
    expect(isProviderModeEnabled()).toBe(false);
  });

  test.each([['true'], ['1'], ['yes'], [1]])('stays off for %p', (value) => {
    setExtra({ devApproveProvider: value });
    expect(isDevProviderApprovalEnabled()).toBe(false);
  });
});
