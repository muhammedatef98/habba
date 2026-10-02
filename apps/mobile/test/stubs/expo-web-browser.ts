/**
 * Test stub for `expo-web-browser`, which reaches React Native (see
 * vitest.config.ts). A unit test never opens a browser; this says so.
 */

export async function openAuthSessionAsync(): Promise<{ type: 'dismiss' }> {
  return { type: 'dismiss' };
}
