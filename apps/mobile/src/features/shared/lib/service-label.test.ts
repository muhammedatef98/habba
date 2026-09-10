import { describe, expect, it } from 'vitest';
import { shortServiceName } from './service-label.js';

describe('shortServiceName', () => {
  it('cuts at the em-dash the Arabic catalogue uses', () => {
    expect(shortServiceName('بطارية — شحن أو تبديل')).toBe('بطارية');
  });

  it('cuts at the conjunction when there is no dash', () => {
    expect(shortServiceName('Battery jump or replacement')).toBe('Battery jump');
    expect(shortServiceName('Tyre puncture or change')).toBe('Tyre puncture');
  });

  it('leaves a name that is already short alone', () => {
    expect(shortServiceName('Towing')).toBe('Towing');
    expect(shortServiceName('ونش/سحب')).toBe('ونش/سحب');
    expect(shortServiceName('Lockout assistance')).toBe('Lockout assistance');
  });

  it('never returns an empty label, whatever the separator position', () => {
    // A name that opens with a separator would otherwise cut to nothing, and a
    // blank tile is worse than a long one.
    expect(shortServiceName('— something')).toBe('— something');
    expect(shortServiceName(' or else')).toBe('or else');
  });

  it('trims the surrounding whitespace it inherits from the cut', () => {
    expect(shortServiceName('Oil change  —  filter included')).toBe('Oil change');
  });
});
