/**
 * SAR money type.
 *
 * CLAUDE.md §2.5: money is `numeric(12,2)`, never float. That rule is only
 * worth anything if it survives the trip into JavaScript — where `0.1 + 0.2`
 * is famously not `0.3`, and where a single `parseFloat` on a price silently
 * reintroduces the bug the database column was chosen to prevent.
 *
 * So: `SarAmount` is a *branded string* holding a fixed 2-decimal
 * representation. It cannot be produced by accident, and arithmetic goes
 * through this module, which works in integer halalas internally and is
 * therefore exact.
 *
 * Authoritative arithmetic still happens in Postgres (CLAUDE.md §2.2). This
 * type exists so the client can display and cross-check without corrupting
 * values in transit. See ADR-0007.
 */

declare const SAR_BRAND: unique symbol;

/** A SAR amount with exactly two decimal places, e.g. `"149.50"`. */
export type SarAmount = string & { readonly [SAR_BRAND]: 'SAR' };

/** numeric(12,2) — ten integer digits, two decimal. */
const MAX_HALALAS = 999_999_999_999n;

export type SarError = 'not_a_number' | 'too_many_decimals' | 'out_of_range' | 'negative';

export type SarResult =
  | { readonly ok: true; readonly amount: SarAmount }
  | { readonly ok: false; readonly error: SarError };

const SAR_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/** Internal: exact conversion to integer halalas. No float anywhere. */
function toHalalas(amount: SarAmount): bigint {
  const negative = amount.startsWith('-');
  const body = negative ? amount.slice(1) : amount;
  const [whole = '0', fraction = '00'] = body.split('.');
  const halalas = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -halalas : halalas;
}

function fromHalalas(halalas: bigint): SarAmount {
  const negative = halalas < 0n;
  const abs = negative ? -halalas : halalas;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}` as SarAmount;
}

/**
 * The only sanctioned way to construct a `SarAmount`.
 *
 * Accepts a string (from the database or an API — the Supabase client returns
 * `numeric` as a string, which is exactly why this takes one) or an integer
 * number of halalas. It deliberately does NOT accept a floating-point number:
 * by the time a price is a JS `number`, precision may already be gone.
 */
export function sar(input: string): SarResult {
  const trimmed = input.trim();

  if (!SAR_PATTERN.test(trimmed)) {
    return { ok: false, error: trimmed.includes('.') ? 'too_many_decimals' : 'not_a_number' };
  }

  const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.');
  const normalised = `${trimmed.startsWith('-') ? '-' : ''}${whole}.${fraction.padEnd(2, '0')}`;
  const amount = normalised as SarAmount;

  const halalas = toHalalas(amount);
  if (halalas > MAX_HALALAS || halalas < -MAX_HALALAS) {
    return { ok: false, error: 'out_of_range' };
  }

  return { ok: true, amount };
}

/** Construct from an integer count of halalas. `sarFromHalalas(14950)` → `"149.50"`. */
export function sarFromHalalas(halalas: number | bigint): SarResult {
  const value = BigInt(halalas);
  if (value > MAX_HALALAS || value < -MAX_HALALAS) return { ok: false, error: 'out_of_range' };
  return { ok: true, amount: fromHalalas(value) };
}

/** Throwing constructor for literals known-good at author time (tests, seeds). */
export function sarOrThrow(input: string): SarAmount {
  const result = sar(input);
  if (!result.ok) throw new Error(`Invalid SAR amount "${input}": ${result.error}`);
  return result.amount;
}

export const SAR_ZERO: SarAmount = '0.00' as SarAmount;

export function addSar(a: SarAmount, b: SarAmount): SarAmount {
  return fromHalalas(toHalalas(a) + toHalalas(b));
}

export function subtractSar(a: SarAmount, b: SarAmount): SarAmount {
  return fromHalalas(toHalalas(a) - toHalalas(b));
}

export function sumSar(amounts: readonly SarAmount[]): SarAmount {
  return fromHalalas(amounts.reduce((total, amount) => total + toHalalas(amount), 0n));
}

export function multiplySar(amount: SarAmount, quantity: number): SarAmount {
  if (!Number.isInteger(quantity)) {
    throw new Error('multiplySar takes an integer quantity; use applyRate for fractional factors');
  }
  return fromHalalas(toHalalas(amount) * BigInt(quantity));
}

/**
 * Saudi VAT, as a rate string `applyRate` accepts.
 *
 * CLAUDE.md §5 fixes it at 15%. A constant rather than a literal at each call
 * site because a rate change is a legislative event, not a refactor — when it
 * moves it must move in exactly one place, and every place that charges it
 * must be findable by following one symbol.
 */
export const SAUDI_VAT_RATE = '0.15';

/**
 * Multiplies by a rate (e.g. VAT 0.15) and rounds half away from zero to 2dp.
 *
 * ADR-0007: ROUND_HALF_UP, matching Postgres `numeric` `round()`. Banker's
 * rounding is NOT used — the two disagree on exact halves, and the database is
 * the authority we have to match.
 *
 * `rate` is given as a string to keep the caller out of float territory
 * (`"0.15"`, not `0.15`).
 */
export function applyRate(amount: SarAmount, rate: string): SarAmount {
  const [rateWhole = '0', rateFraction = ''] = rate.trim().split('.');
  const scale = BigInt(10) ** BigInt(rateFraction.length);
  const rateScaled = BigInt(rateWhole) * scale + BigInt(rateFraction || '0');

  const halalas = toHalalas(amount);
  const product = halalas * rateScaled;

  // Round half away from zero.
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + scale / 2n) / scale;

  return fromHalalas(negative ? -rounded : rounded);
}

export function compareSar(a: SarAmount, b: SarAmount): -1 | 0 | 1 {
  const left = toHalalas(a);
  const right = toHalalas(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isZeroSar(amount: SarAmount): boolean {
  return toHalalas(amount) === 0n;
}

export function isNegativeSar(amount: SarAmount): boolean {
  return toHalalas(amount) < 0n;
}

/** Halalas, for callers that need an integer (analytics, PSP payloads). */
export function halalasOf(amount: SarAmount): bigint {
  return toHalalas(amount);
}
