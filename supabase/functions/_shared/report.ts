// GENERATED FILE — DO NOT EDIT.
// Source: packages/core/src/report/{types,qr,render}.ts
// Regenerate: ./supabase/scripts/sync-edge-shared.sh
//
// Edge Functions run on Deno and cannot import pnpm workspace packages, so
// this module is vendored here. CI runs this script with --check, so drift
// fails the build rather than quietly shipping stale behaviour.

/**
 * تقرير هبّة payload — the shape `generate_habba_report` produces.
 *
 * Shared between the database (which builds it), the app (which shares it) and
 * the public page (which renders it). Kept in @habba/core so all three agree
 * on one definition rather than three drifting ones.
 */

export type ReportProvenance =
  'self_reported' | 'self_documented' | 'habba_verified' | 'third_party';

export interface ReportVehicle {
  readonly make_ar: string;
  readonly make_en: string;
  readonly model_ar: string;
  readonly model_en: string;
  readonly year: number;
  readonly plate: string | null;
  readonly vin: string | null;
  readonly colour: string | null;
  readonly current_mileage: number;
}

export interface ReportCoverage {
  readonly total: number;
  readonly habba_verified: number;
  readonly self_documented: number;
  readonly self_reported: number;
  readonly third_party: number;
}

export interface ReportEvent {
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly event_type: string;
  readonly provenance: ReportProvenance;
  readonly summary_ar: string;
  readonly summary_en: string;
  readonly mileage: number | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly attachment_count: number;
}

export interface ReportMileagePoint {
  readonly occurred_at: string;
  readonly mileage: number;
}

export interface HabbaReport {
  readonly report_version: number;
  readonly generated_at: string;
  readonly vehicle: ReportVehicle;
  readonly ownership: { readonly months_on_habba: number };
  readonly chain: { readonly is_valid: boolean; readonly length: number };
  readonly coverage: ReportCoverage;
  readonly mileage_history: readonly ReportMileagePoint[];
  readonly events: readonly ReportEvent[];
}

/**
 * Share of the history Habba itself produced, 0–1.
 *
 * This is the number the report leads with, and the reason it is honest to
 * lead with it: it is simultaneously the buyer's confidence signal and the
 * owner's reason to route the next service through Habba. See ADR-0005.
 */
export function verifiedRatio(coverage: ReportCoverage): number {
  if (coverage.total === 0) return 0;
  return coverage.habba_verified / coverage.total;
}

export function isVerifiedEntry(provenance: ReportProvenance): boolean {
  return provenance === 'habba_verified';
}

/**
 * QR encoder — byte mode, error correction level M, versions 1–10.
 *
 * تقرير هبّة is read by a buyer standing next to a car. The QR on it is how
 * they get from a printed page to the live, verifiable report, so it has to be
 * *in* the page: the report renders with no JavaScript and no external requests
 * (see render.ts), and the Edge Function that serves it vendors this file
 * through supabase/scripts/sync-edge-shared.sh. A QR fetched from an image
 * service would break both properties, and would tell that service which
 * vehicles are being sold.
 *
 * Hence: written here rather than pulled in. It is one algorithm with fixed
 * tables, it has no dependencies, and qr.test.ts round-trips the output through
 * a real decoder so this is not "probably a QR code".
 *
 * Scope is deliberate. Byte mode covers URLs; level M is the standard tradeoff
 * (~15% recoverable, which survives a phone camera and a printed page); ten
 * versions carry 213 characters, and a report URL is around 60. Anything longer
 * throws rather than silently producing an unscannable code.
 *
 * Reference: ISO/IEC 18004. The tables below are from that standard and are not
 * derivable — they are transcribed, and the round-trip test is what proves the
 * transcription.
 */

/** Data codewords per version at ECC level M. */
const DATA_CODEWORDS_M = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216] as const;

/**
 * Block structure per version at ECC level M:
 * [ec codewords per block, group1 block count, group1 data codewords,
 *  group2 block count, group2 data codewords]
 */
const BLOCKS_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

/** Alignment pattern centre coordinates per version (empty for version 1). */
const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** 18-bit version information, versions 7–10. Versions below 7 carry none. */
const VERSION_INFO: Readonly<Record<number, number>> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

// ---------------------------------------------------------------------------
// GF(256) arithmetic for Reed–Solomon
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // The QR field polynomial, x^8 + x^4 + x^3 + x^2 + 1.
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] as number;
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] as number) + (LOG[b] as number)] as number;
}

/**
 * Generator polynomial for `degree` error-correction codewords, as
 * (x - α^0)(x - α^1)…(x - α^(degree-1)).
 *
 * Coefficients are ordered highest-degree FIRST, so index 0 is the leading 1
 * that `errorCorrection` skips. Getting that order backwards produces a
 * polynomial of the right length and the right coefficients in the wrong
 * places — the encoder then emits a well-formed code with wrong parity, which
 * looks perfect and scans as nothing.
 */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      // multiply by x …
      next[j] = (next[j] as number) ^ (poly[j] as number);
      // … and by α^i
      next[j + 1] = (next[j + 1] as number) ^ mul(poly[j] as number, EXP[i] as number);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data: readonly number[], ecCount: number): number[] {
  const generator = generatorPoly(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number);
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i += 1) {
      remainder[i] = (remainder[i] as number) ^ mul(generator[i + 1] as number, factor);
    }
  }

  return remainder;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function toUtf8(text: string): number[] {
  const bytes: number[] = [];
  for (const byte of new TextEncoder().encode(text)) bytes.push(byte);
  return bytes;
}

function pickVersion(byteLength: number): number {
  for (let version = 1; version <= 10; version += 1) {
    // 4 bits mode + 8 or 16 bits length + the data itself, in codewords.
    const lengthBits = version < 10 ? 8 : 16;
    const needed = Math.ceil((4 + lengthBits + byteLength * 8) / 8);
    if (needed <= (DATA_CODEWORDS_M[version - 1] as number)) return version;
  }
  throw new Error(
    `qr: ${byteLength} bytes exceeds the 213-byte ceiling of version 10 at ECC level M`,
  );
}

function dataCodewords(bytes: readonly number[], version: number): number[] {
  const capacity = DATA_CODEWORDS_M[version - 1] as number;
  const lengthBits = version < 10 ? 8 : 16;

  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, lengthBits);
  for (const byte of bytes) push(byte, 8);

  // Terminator, then pad to a byte boundary.
  const terminator = Math.min(4, capacity * 8 - bits.length);
  push(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] as number);
    codewords.push(byte);
  }

  // The standard's alternating pad bytes, until the version is full.
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < capacity) {
    codewords.push(PAD[padIndex % 2] as number);
    padIndex += 1;
  }

  return codewords;
}

/** Splits into blocks, appends EC to each, and interleaves as the spec requires. */
function interleave(codewords: readonly number[], version: number): number[] {
  const [ecPerBlock, group1Count, group1Size, group2Count, group2Size] = BLOCKS_M[
    version - 1
  ] as readonly [number, number, number, number, number];

  const blocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < group1Count; i += 1) {
    blocks.push(codewords.slice(offset, offset + group1Size));
    offset += group1Size;
  }
  for (let i = 0; i < group2Count; i += 1) {
    blocks.push(codewords.slice(offset, offset + group2Size));
    offset += group2Size;
  }

  const ecBlocks = blocks.map((block) => errorCorrection(block, ecPerBlock));

  const result: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) {
      if (i < block.length) result.push(block[i] as number);
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i] as number);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

type Cell = 0 | 1 | null;

function placeFunctionPatterns(matrix: Cell[][], version: number): boolean[][] {
  const size = matrix.length;
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  const set = (row: number, col: number, value: 0 | 1) => {
    (matrix[row] as Cell[])[col] = value;
    (reserved[row] as boolean[])[col] = true;
  };

  // Finder patterns and their separators.
  for (const [baseRow, baseCol] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let row = -1; row <= 7; row += 1) {
      for (let col = -1; col <= 7; col += 1) {
        const r = baseRow + row;
        const c = baseCol + col;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;

        const onRing = row === 0 || row === 6 || col === 0 || col === 6;
        const inCore = row >= 2 && row <= 4 && col >= 2 && col <= 4;
        const inside = row >= 0 && row <= 6 && col >= 0 && col <= 6;
        set(r, c, inside && (onRing || inCore) ? 1 : 0);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    const value: 0 | 1 = i % 2 === 0 ? 1 : 0;
    set(6, i, value);
    set(i, 6, value);
  }

  // Alignment patterns, skipping the three that would collide with finders.
  const centres = ALIGNMENT[version - 1] as readonly number[];
  for (const row of centres) {
    for (const col of centres) {
      const nearFinder =
        (row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8);
      if (nearFinder) continue;

      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const outer = Math.max(Math.abs(dr), Math.abs(dc));
          set(row + dr, col + dc, outer === 1 ? 0 : 1);
        }
      }
    }
  }

  // The dark module, always at (4 * version + 9, 8).
  set(4 * version + 9, 8, 1);

  // Reserve the format-information areas; the values land after masking.
  for (let i = 0; i < 9; i += 1) {
    if (!(reserved[8] as boolean[])[i]) {
      (reserved[8] as boolean[])[i] = true;
      (matrix[8] as Cell[])[i] = 0;
    }
    if (!(reserved[i] as boolean[])[8]) {
      (reserved[i] as boolean[])[8] = true;
      (matrix[i] as Cell[])[8] = 0;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    (reserved[8] as boolean[])[size - 1 - i] = true;
    (matrix[8] as Cell[])[size - 1 - i] = 0;
    (reserved[size - 1 - i] as boolean[])[8] = true;
    (matrix[size - 1 - i] as Cell[])[8] = 0;
  }

  // Version information (versions 7 and up).
  const info = VERSION_INFO[version];
  if (info !== undefined) {
    for (let i = 0; i < 18; i += 1) {
      const bit: 0 | 1 = ((info >> i) & 1) === 1 ? 1 : 0;
      const row = Math.floor(i / 3);
      const col = size - 11 + (i % 3);
      set(row, col, bit);
      set(col, row, bit);
    }
  }

  return reserved;
}

function placeData(matrix: Cell[][], reserved: boolean[][], stream: readonly number[]): void {
  const size = matrix.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; the zigzag skips over it.
    const rightCol = right <= 6 ? right - 1 : right;

    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;

      for (const col of [rightCol, rightCol - 1]) {
        if ((reserved[row] as boolean[])[col]) continue;

        const byte = stream[bitIndex >> 3] ?? 0;
        const bit = (byte >> (7 - (bitIndex & 7))) & 1;
        (matrix[row] as Cell[])[col] = bit === 1 ? 1 : 0;
        bitIndex += 1;
      }
    }

    upward = !upward;
  }
}

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/** ISO/IEC 18004 §8.9 penalty scoring; the lowest-scoring mask wins. */
function penalty(matrix: readonly (readonly Cell[])[]): number {
  const size = matrix.length;
  let score = 0;

  const at = (row: number, col: number): number => ((matrix[row] as Cell[])[col] === 1 ? 1 : 0);

  // Rule 1: runs of five or more identical modules.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const current = horizontal ? at(i, j) : at(j, i);
        const previous = horizontal ? at(i, j - 1) : at(j - 1, i);
        if (current === previous) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const first = at(row, col);
      if (
        first === at(row, col + 1) &&
        first === at(row + 1, col) &&
        first === at(row + 1, col + 1)
      ) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns.
  const patterns = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 11 <= size; j += 1) {
      for (const pattern of patterns) {
        let horizontal = true;
        let vertical = true;
        for (let k = 0; k < 11; k += 1) {
          if (at(i, j + k) !== pattern[k]) horizontal = false;
          if (at(j + k, i) !== pattern[k]) vertical = false;
        }
        if (horizontal) score += 40;
        if (vertical) score += 40;
      }
    }
  }

  // Rule 4: deviation from an even balance of dark and light.
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) dark += at(row, col);
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function formatBits(mask: number): number {
  // ECC level M is 0b00; the 15-bit BCH code and final XOR are from the spec.
  const data = (0b00 << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if ((value >> (10 + i)) & 1) value ^= 0b10100110111 << i;
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

function applyFormat(matrix: Cell[][], mask: number): void {
  const size = matrix.length;
  const bits = formatBits(mask);

  // The two copies are NOT mirror images of each other, and the row/column
  // order is easy to transpose by accident — a transposed format block still
  // produces a code that looks perfect and decodes as nothing, which is exactly
  // what happened here before qr.test.ts round-tripped it through a decoder.
  for (let i = 0; i < 15; i += 1) {
    const bit: Cell = ((bits >> i) & 1) === 1 ? 1 : 0;

    // Copy one: down column 8, then left along row 8 (skipping the timing
    // module, which is why the indices jump at 6 and 8).
    if (i < 6) (matrix[i] as Cell[])[8] = bit;
    else if (i === 6) (matrix[7] as Cell[])[8] = bit;
    else if (i === 7) (matrix[8] as Cell[])[8] = bit;
    else if (i === 8) (matrix[8] as Cell[])[7] = bit;
    else (matrix[8] as Cell[])[14 - i] = bit;

    // Copy two: along row 8 from the right edge, then up column 8 from the
    // bottom edge.
    if (i < 8) (matrix[8] as Cell[])[size - 1 - i] = bit;
    else (matrix[size - 15 + i] as Cell[])[8] = bit;
  }

  // The dark module sits inside the area copy two writes through, so it is
  // restored last rather than defended earlier.
  (matrix[size - 8] as Cell[])[8] = 1;
}

/**
 * Encodes `text` and returns the module matrix — true is a dark module.
 *
 * The quiet zone is NOT included: it is a rendering concern, and `qrSvg()`
 * adds it. A matrix printed without one does not scan.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = toUtf8(text);
  const version = pickVersion(bytes.length);
  const size = version * 4 + 17;

  const stream = interleave(dataCodewords(bytes, version), version);

  let best: { matrix: Cell[][]; score: number } | null = null;

  for (let mask = 0; mask < 8; mask += 1) {
    const matrix: Cell[][] = Array.from({ length: size }, () => new Array<Cell>(size).fill(null));
    const reserved = placeFunctionPatterns(matrix, version);
    placeData(matrix, reserved, stream);

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if ((reserved[row] as boolean[])[col]) continue;
        if (maskBit(mask, row, col)) {
          (matrix[row] as Cell[])[col] = (matrix[row] as Cell[])[col] === 1 ? 0 : 1;
        }
      }
    }

    applyFormat(matrix, mask);

    const score = penalty(matrix);
    if (best === null || score < best.score) best = { matrix, score };
  }

  const chosen = (best as { matrix: Cell[][] }).matrix;
  return chosen.map((row) => row.map((cell) => cell === 1));
}

export interface QrSvgOptions {
  /** Modules of quiet zone. The standard requires 4; less does not scan. */
  readonly quietZone?: number;
  /** Accessible label. The report passes what the code points at. */
  readonly title: string;
}

/**
 * Renders the matrix as an inline SVG string.
 *
 * `viewBox` in module units with no fixed width or height, so the caller sizes
 * it in CSS — the report shows it small on screen and large in print from the
 * same markup. One `<path>` for all dark modules rather than a rect each: a
 * version-10 code is 3,249 modules, and 3,249 elements is a slow page on the
 * roadside phone this is read on.
 */
export function qrSvg(text: string, options: QrSvgOptions): string {
  const matrix = qrMatrix(text);
  const quiet = options.quietZone ?? 4;
  const size = matrix.length + quiet * 2;

  const parts: string[] = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if ((matrix[row] as boolean[])[col]) {
        parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
      }
    }
  }

  const title = options.title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `role="img" aria-label="${title}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#FFFFFF"/>` +
    `<path d="${parts.join('')}" fill="#0F0E0D"/>` +
    `</svg>`
  );
}

/**
 * Renders تقرير هبّة as a self-contained Arabic RTL HTML page.
 *
 * Build prompt §7.3: "the public page must work without login and be
 * mobile-first". It is also the page a buyer opens while standing next to a
 * car they are deciding whether to buy — on their phone, possibly on mobile
 * data, in daylight.
 *
 * So: no JavaScript, no external requests, inline CSS, and a print stylesheet
 * that produces a usable PDF via the browser's own print-to-PDF. That last
 * point is deliberate — see the PDF note in the Phase 2 section of
 * docs/adr/0016-habba-report-delivery.md.
 *
 * Pure string in, string out, so it is unit-testable without a browser or a
 * deployed function.
 */


/**
 * Escapes text for HTML.
 *
 * The report renders owner-typed strings (service descriptions) into a public
 * page. Without escaping, an owner could inject markup into a page a buyer
 * trusts — the exact XSS the security rules forbid.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PROVENANCE_LABEL_AR: Record<ReportProvenance, string> = {
  habba_verified: 'موثّق من هبّة',
  self_documented: 'مُدخل من المالك مع مرفق',
  self_reported: 'مُدخل من المالك',
  third_party: 'من جهة خارجية',
};

const DETAIL_LABEL_AR: Record<string, string> = {
  oil_grade: 'درجة الزيت',
  oil_quantity_l: 'كمية الزيت (لتر)',
  filter_part_number: 'رقم الفلتر',
  part_number: 'رقم القطعة',
  is_oem: 'قطعة أصلية',
  warranty_days: 'الضمان (يوم)',
  labour_hours: 'ساعات العمل',
  service_kind: 'نوع الخدمة',
  inspection_score: 'نتيجة الفحص',
  obd_codes: 'أكواد الكمبيوتر',
  tyre_size: 'مقاس الإطار',
  battery_capacity_ah: 'سعة البطارية',
  brake_pad_position: 'موضع الفحمات',
  notes_public: 'ملاحظات',
};

function formatNumber(value: number): string {
  // Latin numerals: §8 notes Saudi users prefer 1234 over ١٢٣٤ on screen.
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return formatNumber(value);
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join('، ');
  return String(value);
}

function renderDetails(details: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(details).filter(([, value]) => value !== null && value !== '');
  if (entries.length === 0) return '';

  const items = entries
    .map(([key, value]) => {
      const label = DETAIL_LABEL_AR[key] ?? key;
      return `<span class="detail"><b>${escapeHtml(label)}:</b> ${escapeHtml(
        formatDetailValue(value),
      )}</span>`;
    })
    .join('');

  return `<div class="details">${items}</div>`;
}

function renderEvent(event: ReportEvent): string {
  const verified = event.provenance === 'habba_verified';
  const label = PROVENANCE_LABEL_AR[event.provenance];

  // Where an event was recorded materially later than it happened, say so
  // (ADR-0012). A buyer reading a history deserves to know which entries were
  // written at the time and which were written from memory.
  const lag =
    new Date(event.recorded_at).getTime() - new Date(event.occurred_at).getTime() >
    7 * 24 * 60 * 60 * 1000
      ? `<span class="lag">سُجّل لاحقاً في ${escapeHtml(event.recorded_at)}</span>`
      : '';

  const mileage =
    event.mileage === null ? '' : `<span class="km">${formatNumber(event.mileage)} كم</span>`;

  const attachments =
    event.attachment_count > 0
      ? `<span class="attach">${formatNumber(event.attachment_count)} مرفق</span>`
      : '';

  return `
    <li class="event ${verified ? 'is-verified' : 'is-self'}">
      <div class="event-head">
        <span class="badge ${verified ? 'badge-verified' : 'badge-self'}">${escapeHtml(label)}</span>
        <time>${escapeHtml(event.occurred_at)}</time>
      </div>
      <p class="summary">${escapeHtml(event.summary_ar)}</p>
      <div class="meta">${mileage}${attachments}${lag}</div>
      ${renderDetails(event.details)}
    </li>`;
}

export interface RenderOptions {
  /** Absolute URL of this report, shown as the verification target. */
  readonly publicUrl: string;
}

export function renderHabbaReport(report: HabbaReport, options: RenderOptions): string {
  const { vehicle, coverage, chain } = report;
  const ratio = Math.round(verifiedRatio(coverage) * 100);

  const title = `${vehicle.make_ar} ${vehicle.model_ar} ${vehicle.year}`;

  const identity = [
    vehicle.plate === null
      ? null
      : `<div><dt>اللوحة</dt><dd>${escapeHtml(vehicle.plate)}</dd></div>`,
    vehicle.vin === null
      ? null
      : `<div><dt>رقم الهيكل</dt><dd>${escapeHtml(vehicle.vin)}</dd></div>`,
    vehicle.colour === null
      ? null
      : `<div><dt>اللون</dt><dd>${escapeHtml(vehicle.colour)}</dd></div>`,
    `<div><dt>العداد</dt><dd>${formatNumber(vehicle.current_mileage)} كم</dd></div>`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join('');

  const events = report.events.map(renderEvent).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تقرير هبّة — ${escapeHtml(title)}</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root {
    --petrol: #0E4F4A; --petrol-50: #E6F2F0; --sand: #C98B2B;
    --ink: #1A1917; --muted: #5C5952; --line: #DFDDD9; --bg: #F7F7F6;
    --surface: #FFFFFF;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: "IBM Plex Sans Arabic", "Tajawal", system-ui, -apple-system, sans-serif;
    /* Arabic needs the taller rhythm — §8. */
    line-height: 1.7; font-size: 16px;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
  header { background: var(--petrol); color: #fff; border-radius: 16px; padding: 24px; }
  header h1 { margin: 0 0 4px; font-size: 26px; line-height: 1.4; }
  header .sub { opacity: .85; font-size: 14px; }
  .card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 16px; padding: 20px; margin-top: 16px;
  }
  h2 { font-size: 18px; margin: 0 0 12px; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0; }
  dt { font-size: 13px; color: var(--muted); margin: 0; }
  dd { margin: 0; font-weight: 600; }
  .ratio { display: flex; align-items: baseline; gap: 8px; }
  .ratio b { font-size: 34px; color: var(--petrol); }
  .bar { height: 10px; border-radius: 99px; background: var(--line); overflow: hidden; margin: 12px 0 8px; }
  .bar > i { display: block; height: 100%; background: var(--petrol); }
  .legend { font-size: 13px; color: var(--muted); }
  ul.events { list-style: none; margin: 0; padding: 0; }
  .event { border-top: 1px solid var(--line); padding: 16px 0; }
  .event:first-child { border-top: 0; }
  .event-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  time { color: var(--muted); font-size: 13px; }
  .badge { font-size: 12px; padding: 2px 10px; border-radius: 99px; }
  .badge-verified { background: var(--petrol-50); color: var(--petrol); border: 1px solid var(--petrol); font-weight: 600; }
  .badge-self { background: #EFEEEC; color: #5C5952; }
  .summary { margin: 8px 0 4px; font-weight: 600; }
  .meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  .details { margin-top: 8px; font-size: 13px; color: var(--muted); display: flex; gap: 12px; flex-wrap: wrap; }
  .verify { background: var(--petrol-50); border-color: var(--petrol); }
  .verify code { word-break: break-all; font-size: 12px; }
  /* The QR is the whole point of the printed page: a buyer holding paper has
     no other way to reach the live report. It stays large enough to scan from
     a phone at arm's length (about 30mm printed) and never shrinks below it. */
  .verify-qr { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .verify-qr svg { width: 128px; height: 128px; flex: none; background: #fff; }
  .verify-qr .legend { flex: 1 1 200px; min-width: 200px; }
  footer { color: var(--muted); font-size: 12px; text-align: center; padding: 24px 0; }
  /* Print-to-PDF is the delivery mechanism for now — ADR-0016. */
  @media print {
    body { background: #fff; font-size: 12px; }
    .card, header { break-inside: avoid; border-radius: 0; }
    header { background: #fff !important; color: var(--ink); border-bottom: 3px solid var(--petrol); }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">تقرير هبّة — سجل الصيانة الموثّق</div>
  </header>

  <section class="card">
    <h2>بيانات السيارة</h2>
    <dl>${identity}</dl>
  </section>

  <section class="card">
    <h2>نسبة التوثيق</h2>
    <div class="ratio"><b>${formatNumber(ratio)}%</b><span>من السجلات موثّقة من هبّة</span></div>
    <div class="bar"><i style="width:${ratio}%"></i></div>
    <p class="legend">
      ${formatNumber(coverage.habba_verified)} سجل موثّق من هبّة ·
      ${formatNumber(coverage.self_documented + coverage.self_reported)} سجل مُدخل من المالك ·
      ${formatNumber(coverage.total)} إجمالي
    </p>
    <p class="legend">
      السجلات الموثّقة من هبّة نفّذها فنّي عبر التطبيق مع صور وقراءة عداد.
      السجلات المُدخلة من المالك أدخلها صاحب السيارة ولم تتحقّق منها هبّة.
    </p>
  </section>

  <section class="card">
    <h2>سجل الصيانة</h2>
    <ul class="events">${events}</ul>
  </section>

  <section class="card verify">
    <h2>التحقّق</h2>
    <p class="legend">
      ${
        chain.is_valid
          ? `تم التحقّق من سلسلة السجلات (${formatNumber(chain.length)} سجل) ولم تتعرّض للتعديل منذ تسجيلها.`
          : 'تعذّر التحقّق من سلسلة السجلات.'
      }
    </p>
    <p class="legend">
      هذا التحقّق يثبت أن السجلات لم تُعدَّل بعد إدخالها. ولا يثبت صحة السجلات
      التي أدخلها المالك بنفسه.
    </p>
    <div class="verify-qr">
      ${qrSvg(options.publicUrl, { title: 'رمز التحقّق من تقرير هبّة' })}
      <p class="legend">
        امسح الرمز للاطّلاع على هذا التقرير مباشرة من هبّة والتأكّد من أنه لم يُعدَّل.
      </p>
    </div>
    <code>${escapeHtml(options.publicUrl)}</code>
  </section>

  <footer>
    صدر بتاريخ ${escapeHtml(report.generated_at)} · هبّة
  </footer>
</div>
</body>
</html>`;
}
