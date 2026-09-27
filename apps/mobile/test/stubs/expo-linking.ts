/**
 * Test stub for `expo-linking`, which reaches React Native (see
 * vitest.config.ts). Only what lib/moyasar-card-form.ts calls.
 */

export function createURL(path: string): string {
  return `habba://${path}`;
}

export function parse(url: string): { queryParams: Record<string, string> } {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return { queryParams: Object.fromEntries(new URLSearchParams(query)) };
}
