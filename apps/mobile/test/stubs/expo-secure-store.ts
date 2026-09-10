/**
 * Test stub for `expo-secure-store`.
 *
 * Same reason as the `expo-constants` stub beside it: the real module reaches
 * React Native, whose Flow-typed source Vitest cannot parse — so importing
 * `data/repository.ts` at all was impossible, because it reaches
 * `state/session` → `lib/preferences` → here.
 *
 * An in-memory map rather than a set of no-ops. `readStoredSession` is expected
 * to return what `writeStoredSession` last wrote (that round trip is the whole
 * point of persisting the sign-in), and a stub that always returned null would
 * make that behaviour untestable while looking like it worked.
 */

const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}
