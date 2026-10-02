import { describe, expect, it } from 'vitest';
import { distanceBandOf, distanceLabel } from './distance-band.js';

describe('distance bands', () => {
  it('recognises each of the four buckets list_open_jobs returns (0021)', () => {
    expect(distanceBandOf('أقل من ٢ كم')).toBe('under2');
    expect(distanceBandOf('٢–٥ كم')).toBe('from2to5');
    expect(distanceBandOf('٥–١٠ كم')).toBe('from5to10');
    expect(distanceBandOf('أكثر من ١٠ كم')).toBe('over10');
  });

  it('words a known band through the translator', () => {
    expect(distanceLabel('٢–٥ كم', (key) => key)).toBe('provider.distanceBand.from2to5');
  });

  it('shows an unknown wording as sent, in Latin digits, rather than hiding it', () => {
    expect(distanceLabel('٣ كم تقريباً', (key) => key)).toBe('3 كم تقريباً');
  });
});
