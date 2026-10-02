import { afterEach, describe, expect, it } from 'vitest';
import appConfig, { missingForStore } from './app.config';

/**
 * A store build without a Supabase project ships the in-memory demo with the
 * dev OTP code. It must fail to build rather than reach a reviewer.
 */
const KEYS = [
  'EAS_BUILD_PROFILE',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EAS_PROJECT_ID',
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const base = { config: { name: 'هبّة', slug: 'habba' } } as Parameters<typeof appConfig>[0];

function clear() {
  for (const key of KEYS) delete process.env[key];
}

describe('app.config for the stores', () => {
  it('builds locally with nothing set — the demo is the point there', () => {
    clear();
    expect(appConfig(base).slug).toBe('habba');
  });

  it('refuses a production build that would ship the demo', () => {
    clear();
    process.env['EAS_BUILD_PROFILE'] = 'production';
    expect(() => appConfig(base)).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('names every missing variable, and accepts either key', () => {
    clear();
    expect(missingForStore()).toHaveLength(3);
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'https://x.supabase.co';
    process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = 'anon';
    expect(missingForStore()).toEqual(['EAS_PROJECT_ID']);
  });

  it('builds for production once all three are set', () => {
    clear();
    process.env['EAS_BUILD_PROFILE'] = 'production';
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'https://x.supabase.co';
    process.env['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = 'sb_publishable_x';
    process.env['EAS_PROJECT_ID'] = '00000000-0000-0000-0000-000000000000';
    const config = appConfig(base);
    expect(config.extra?.['supabaseUrl']).toBe('https://x.supabase.co');
    expect(config.extra?.['eas']).toEqual({ projectId: '00000000-0000-0000-0000-000000000000' });
  });
});
