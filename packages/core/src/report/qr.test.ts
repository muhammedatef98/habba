/**
 * The QR encoder is round-tripped through a real decoder.
 *
 * Asserting the matrix "looks like a QR code" — right size, finder patterns in
 * the corners — would pass for an encoder with a wrong generator polynomial, a
 * wrong mask, or bytes placed in the wrong order. None of those are visible by
 * inspection, and all of them produce something that photographs like a QR code
 * and scans as nothing.
 *
 * So the test rasterises the output and hands it to jsQR (a decoder, not the
 * encoder under test) and requires the original string back. jsQR is a
 * devDependency only; nothing ships it.
 */

import jsQR from 'jsqr';
import { describe, expect, test } from 'vitest';
import { qrMatrix, qrSvg } from './qr.js';

const SCALE = 4;
const QUIET = 4;

/** Renders the matrix as RGBA pixels, the shape jsQR expects. */
function rasterise(matrix: readonly (readonly boolean[])[]): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const modules = matrix.length + QUIET * 2;
  const size = modules * SCALE;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);

  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (!(matrix[row] as readonly boolean[])[col]) continue;

      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const y = (row + QUIET) * SCALE + dy;
          const x = (col + QUIET) * SCALE + dx;
          const offset = (y * size + x) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
    }
  }

  return { data, width: size, height: size };
}

function roundTrip(text: string): string | null {
  const { data, width, height } = rasterise(qrMatrix(text));
  return jsQR(data, width, height)?.data ?? null;
}

describe('qrMatrix', () => {
  test('a report URL round-trips through a decoder', () => {
    const url = 'https://habba.sa/r/8ce1f0a2b7d34e6f9a1c2d3e4f5a6b7c';
    expect(roundTrip(url)).toBe(url);
  });

  test('short and long inputs both round-trip', () => {
    // Different versions and different block structures: version 1 has a single
    // block, version 8+ has two groups of unequal size, and interleaving is
    // where a plausible-looking encoder goes wrong.
    expect(roundTrip('habba.sa')).toBe('habba.sa');

    const long = `https://habba.sa/r/${'a1b2c3d4'.repeat(12)}`;
    expect(long.length).toBeGreaterThan(100);
    expect(roundTrip(long)).toBe(long);
  });

  test('Arabic text survives as UTF-8', () => {
    // The report is Arabic-first; a byte-mode encoder that assumed one byte per
    // character would corrupt this and nothing else would notice.
    const text = 'تقرير هبّة';
    expect(roundTrip(text)).toBe(text);
  });

  test('the matrix is square, and sized to a real QR version', () => {
    const size = qrMatrix('https://habba.sa/r/short').length;

    expect(size % 4).toBe(1); // every version is 4n + 17
    expect(size).toBeGreaterThanOrEqual(21);
    expect(size).toBeLessThanOrEqual(57);
  });

  test('refuses input it cannot encode rather than truncating it', () => {
    // Silently dropping the tail would produce a scannable code pointing at the
    // wrong URL — worse than no code at all.
    expect(() => qrMatrix('x'.repeat(300))).toThrow(/exceeds/);
  });
});

describe('qrSvg', () => {
  test('is self-contained, sized by viewBox, and labelled', () => {
    const svg = qrSvg('https://habba.sa/r/token', { title: 'تحقّق من التقرير' });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0');
    expect(svg).toContain('aria-label="تحقّق من التقرير"');
    // No external reference of any kind: the report page makes no network
    // requests (render.ts), and an <image href> would break that silently.
    // The xmlns is an XML namespace identifier, not a URL anything fetches,
    // so what is asserted is the absence of href/src attributes.
    expect(svg).not.toContain('href');
    expect(svg).not.toContain('src=');
    expect(svg).not.toContain('<image');
  });

  test('includes the quiet zone the standard requires', () => {
    const modules = qrMatrix('https://habba.sa/r/token').length;
    const svg = qrSvg('https://habba.sa/r/token', { title: 'q' });

    expect(svg).toContain(`viewBox="0 0 ${modules + 8} ${modules + 8}"`);
  });

  test('escapes the label rather than letting it close the attribute', () => {
    const svg = qrSvg('https://habba.sa/r/token', { title: '"><script>x</script>' });

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;');
  });
});
