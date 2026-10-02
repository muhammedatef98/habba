import { describe, expect, it } from 'vitest';
import { targetFor } from './push-routes.js';

const ORDER = '0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b';

describe('targetFor', () => {
  it('opens the tracking screen, in customer mode, for news about their order', () => {
    const target = targetFor({ route: '/tracking', id: ORDER });
    expect(target?.mode).toBe('customer');
    expect(target?.pathname).toBe('/tracking');
    expect(target?.params).toEqual({ id: ORDER });
    expect(target?.refresh).toContainEqual(['order', ORDER]);
  });

  it('switches a technician to provider mode for a job offer', () => {
    const target = targetFor({ route: '/job', id: ORDER });
    expect(target?.mode).toBe('provider');
    expect(target?.refresh).toContainEqual(['open-jobs']);
  });

  it('opens nothing for a route it does not know — the payload is input', () => {
    expect(targetFor({ route: '/profile', id: ORDER })).toBeNull();
    expect(targetFor({ route: 'https://example.test', id: ORDER })).toBeNull();
  });

  it('opens nothing when an order route carries no usable id', () => {
    expect(targetFor({ route: '/tracking' })).toBeNull();
    expect(targetFor({ route: '/job', id: '../../profile' })).toBeNull();
  });

  it('ignores a payload that is not an object', () => {
    expect(targetFor(null)).toBeNull();
    expect(targetFor('/tracking')).toBeNull();
  });
});
