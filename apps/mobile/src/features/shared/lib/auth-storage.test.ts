import { describe, expect, test, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const { CHUNK_SIZE, createChunkedStorage } = await import('./auth-storage');

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    store: {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (!/^[\w.-]+$/.test(key)) throw new Error(`invalid keychain key ${key}`);
        if (value.length > 2048) throw new Error('value too large for the keychain');
        map.set(key, value);
      },
      deleteItem: async (key: string) => {
        map.delete(key);
      },
    },
  };
}

describe('the sign-in kept on the phone', () => {
  test('a session larger than one keychain entry survives the round trip', async () => {
    const { store } = memoryStore();
    const storage = createChunkedStorage(store);
    const session = JSON.stringify({
      access_token: 'a'.repeat(3000),
      refresh_token: 'r'.repeat(40),
    });

    await storage.setItem('sb-project-auth-token', session);
    expect(await storage.getItem('sb-project-auth-token')).toBe(session);
  });

  test('keys supabase-js uses are made safe for the keychain', async () => {
    const { store, map } = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('sb:weird/key', 'x');
    expect([...map.keys()].every((key) => /^[\w.-]+$/.test(key))).toBe(true);
    expect(await storage.getItem('sb:weird/key')).toBe('x');
  });

  test('a shorter session replaces a longer one without leftovers', async () => {
    const { store, map } = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('k', 'a'.repeat(CHUNK_SIZE * 3));
    await storage.setItem('k', 'short');
    expect(await storage.getItem('k')).toBe('short');
    expect(map.size).toBe(2);
  });

  test('signing out leaves nothing behind', async () => {
    const { store, map } = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('k', 'a'.repeat(CHUNK_SIZE * 2 + 5));
    await storage.removeItem('k');
    expect(map.size).toBe(0);
    expect(await storage.getItem('k')).toBeNull();
  });

  test('a half-written session reads as no session, not a truncated token', async () => {
    const { store, map } = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('k', 'a'.repeat(CHUNK_SIZE * 2));
    map.delete('habba.auth.k.1');
    expect(await storage.getItem('k')).toBeNull();
  });
});
