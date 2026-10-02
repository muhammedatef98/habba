/**
 * Where the Supabase sign-in lives on the phone.
 *
 * The client was created with `persistSession: false`, which was right while
 * nothing could sign in and wrong the moment OTP is switched on: the access
 * and refresh tokens lived in memory only, so after the app was closed every
 * request went out as `anon` — the app still showed the person as signed in
 * (their identity is kept by `lib/preferences`), and every screen came back
 * empty because RLS saw nobody.
 *
 * Kept in the keychain (expo-secure-store), not plain storage: a refresh token
 * is a long-lived credential for the whole account. The keychain refuses
 * values much over 2 KB on some platforms and a Supabase session is about
 * that size, so values are split into chunks under a small index entry.
 *
 * `createChunkedStorage` is the logic, over any key–value store, so it is
 * tested in Node; `authStorage` binds it to the keychain.
 */

import * as SecureStore from 'expo-secure-store';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** What supabase-js asks of a storage adapter. */
export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Comfortably under the keychain's limit, in UTF-16 code units. */
export const CHUNK_SIZE = 1800;

/** Keychain keys allow letters, digits, `.`, `-` and `_` only. */
function safeKey(key: string): string {
  return `habba.auth.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export function createChunkedStorage(store: KeyValueStore): AuthStorage {
  const countKey = (key: string) => `${safeKey(key)}.n`;
  const chunkKey = (key: string, index: number) => `${safeKey(key)}.${index}`;

  async function remove(key: string): Promise<void> {
    const count = Number((await store.getItem(countKey(key))) ?? '0');
    for (let index = 0; index < count; index++) {
      await store.deleteItem(chunkKey(key, index));
    }
    await store.deleteItem(countKey(key));
  }

  return {
    async getItem(key) {
      try {
        const raw = await store.getItem(countKey(key));
        if (raw === null) return null;
        const count = Number(raw);
        if (!Number.isInteger(count) || count < 1) return null;

        const parts: string[] = [];
        for (let index = 0; index < count; index++) {
          const part = await store.getItem(chunkKey(key, index));
          // A missing chunk is a half-written session. Reading it as whole
          // would hand supabase-js a truncated token; no session is honest.
          if (part === null) return null;
          parts.push(part);
        }
        return parts.join('');
      } catch {
        return null;
      }
    },

    async setItem(key, value) {
      try {
        await remove(key);
        const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
        for (let index = 0; index < count; index++) {
          await store.setItem(
            chunkKey(key, index),
            value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
          );
        }
        // The index last: until it is written, a reader finds no session
        // rather than part of one.
        await store.setItem(countKey(key), String(count));
      } catch {
        // Fails soft, like every other preference: the cost is one more
        // sign-in, never an app that will not start.
      }
    },

    async removeItem(key) {
      try {
        await remove(key);
      } catch {
        // See setItem.
      }
    },
  };
}

export const authStorage: AuthStorage = createChunkedStorage({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
});
