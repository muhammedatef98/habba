import { describe, expect, test } from 'vitest';
import { isBelowMinimumVersion } from './app-version';

describe('the release floor', () => {
  test('an older build is below it', () => {
    expect(isBelowMinimumVersion('1.3.9', '1.4.0')).toBe(true);
    expect(isBelowMinimumVersion('1.9.2', '1.10.0')).toBe(true);
  });

  test('the same or a newer build is not', () => {
    expect(isBelowMinimumVersion('1.4.0', '1.4.0')).toBe(false);
    expect(isBelowMinimumVersion('1.4', '1.4.0')).toBe(false);
    expect(isBelowMinimumVersion('2.0.0', '1.99.99')).toBe(false);
  });

  test('an empty or mistyped floor never locks anyone out', () => {
    expect(isBelowMinimumVersion('1.0.0', '')).toBe(false);
    expect(isBelowMinimumVersion('1.0.0', 'v1.4')).toBe(false);
    expect(isBelowMinimumVersion('1.0.0', '1.4 beta')).toBe(false);
  });
});
