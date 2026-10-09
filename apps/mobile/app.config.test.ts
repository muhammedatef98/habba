import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  'EAS_BUILD_PLATFORM',
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

  it('accepts the project ID app.json carries in place of the variable', () => {
    clear();
    const extra = { eas: { projectId: '045794c7-1c02-411c-b2b7-68c4a3d2fe40' } };
    expect(missingForStore(extra)).toHaveLength(2);
    process.env['EAS_BUILD_PROFILE'] = 'production';
    process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'https://x.supabase.co';
    process.env['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = 'sb_publishable_x';
    const config = appConfig({ ...base, config: { ...base.config, extra } });
    expect(config.extra?.['eas']).toEqual(extra.eas);
  });

  it('asks neither store build for a map key — no Google Maps anywhere', () => {
    for (const platform of ['android', 'ios']) {
      clear();
      process.env['EAS_BUILD_PROFILE'] = 'production';
      process.env['EAS_BUILD_PLATFORM'] = platform;
      process.env['EXPO_PUBLIC_SUPABASE_URL'] = 'https://x.supabase.co';
      process.env['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = 'sb_publishable_x';
      process.env['EAS_PROJECT_ID'] = '00000000-0000-0000-0000-000000000000';
      expect(appConfig(base).android?.config?.googleMaps).toBeUndefined();
    }
  });
});

/**
 * Apple rejects a build whose Info.plist asks for something with Expo's
 * English placeholder ("Allow $(PRODUCT_NAME) to …") — and every plugin adds
 * one by default for permissions this app never requests (always-on location,
 * motion, Face ID). Each is either our own sentence or switched off.
 */
describe('permissions the stores will read', () => {
  const app = JSON.parse(readFileSync(join(__dirname, 'app.json'), 'utf8')) as {
    expo: { plugins: (string | [string, Record<string, unknown>])[] };
  };
  const options = (name: string) => {
    const entry = app.expo.plugins.find((plugin) =>
      Array.isArray(plugin) ? plugin[0] === name : plugin === name,
    );
    return Array.isArray(entry) ? entry[1] : {};
  };

  it('switches off the location and Face ID prompts the app never shows', () => {
    expect(options('expo-location')).toMatchObject({
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      motionUsagePermission: false,
    });
    expect(options('expo-secure-store')).toMatchObject({ faceIDPermission: false });
  });

  it('words every prompt it does show itself', () => {
    for (const name of ['expo-camera', 'expo-image-picker', 'expo-location']) {
      for (const [key, value] of Object.entries(options(name))) {
        if (!/Permission$/.test(key) || value === false) continue;
        expect(value, `${name}.${key}`).toMatch(/هبّة/);
      }
    }
  });
});

/**
 * Android draws OpenStreetMap through MapLibre and iOS draws Apple Maps
 * (owner's decision, 2026-10-09). Each library is linked into its own app
 * only, and only that platform's files import it.
 */
describe('one map library per platform', () => {
  const mapDir = join(__dirname, 'src/features/customer/components/map');
  const read = (file: string) => readFileSync(join(mapDir, file), 'utf8');

  it('links react-native-maps into iOS only and MapLibre into Android only', async () => {
    const config = (await import('./react-native.config.js')) as {
      default: { dependencies: Record<string, { platforms: Record<string, null> }> };
    };
    const deps = config.default.dependencies;
    expect(deps['react-native-maps']?.platforms).toEqual({ android: null });
    expect(deps['@maplibre/maplibre-react-native']?.platforms).toEqual({ ios: null });
  });

  it('keeps Google Maps out of the Android map files and MapLibre out of the iOS ones', () => {
    for (const name of ['LocationPicker', 'RouteMap']) {
      expect(read(`${name}.android.tsx`)).not.toMatch(/from 'react-native-maps'/);
      expect(read(`${name}.android.tsx`)).toMatch(/@maplibre\/maplibre-react-native/);
      expect(read(`${name}.tsx`)).not.toMatch(/maplibre/);
    }
  });
});
