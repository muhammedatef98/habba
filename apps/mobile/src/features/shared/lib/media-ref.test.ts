import { describe, expect, test } from 'vitest';
import { parseStorageRef, storageRef } from './media-ref.js';

describe('storage references', () => {
  test('round-trip', () => {
    const ref = storageRef('completion-media', 'f0000000-0000-4000-8000-000000000001/before.jpg');
    expect(ref).toBe('storage://completion-media/f0000000-0000-4000-8000-000000000001/before.jpg');
    expect(parseStorageRef(ref)).toEqual({
      bucket: 'completion-media',
      path: 'f0000000-0000-4000-8000-000000000001/before.jpg',
    });
  });

  test('anything else is not a reference, and is displayed as it is', () => {
    expect(parseStorageRef('https://example.test/a.jpg')).toBeNull();
    expect(parseStorageRef('file:///var/mobile/photo.jpg')).toBeNull();
  });

  test('a reference with no bucket or no path is malformed', () => {
    expect(parseStorageRef('storage://')).toBeNull();
    expect(parseStorageRef('storage:///a.jpg')).toBeNull();
    expect(parseStorageRef('storage://completion-media/')).toBeNull();
    expect(parseStorageRef('storage://completion-media')).toBeNull();
  });
});
