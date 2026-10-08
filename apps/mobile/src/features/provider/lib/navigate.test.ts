import { describe, expect, it } from 'vitest';
import { navigationLinks } from './navigate';

const KHOBAR = { lat: 26.2794, lon: 50.2083 };

describe('navigationLinks', () => {
  it('opens Apple Maps on iOS and Google navigation on Android', () => {
    expect(navigationLinks(KHOBAR, 'ios').native).toBe(
      'maps://?daddr=26.279400,50.208300&dirflg=d',
    );
    expect(navigationLinks(KHOBAR, 'android').native).toBe(
      'google.navigation:q=26.279400,50.208300&mode=d',
    );
  });

  it('falls back to a link any browser can open', () => {
    const links = navigationLinks(KHOBAR, 'web');
    expect(links.native).toBe(links.web);
    expect(links.web).toContain('destination=26.279400,50.208300');
  });

  it('puts latitude first for Waze, as its links expect', () => {
    expect(navigationLinks(KHOBAR, 'ios').waze).toBe(
      'https://waze.com/ul?ll=26.279400,50.208300&navigate=yes',
    );
  });
});
