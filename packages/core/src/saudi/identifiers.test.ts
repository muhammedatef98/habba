import { describe, expect, test } from 'vitest';
import { toLatinDigits, digitsOnly } from './digits.js';
import { formatIban, isValidSaudiIban, maskIban, validateSaudiIban } from './iban.js';
import { maskNationalId, validateNationalId } from './national-id.js';
import { maskPhone, parseSaudiPhone } from './phone.js';
import { validateVatNumber } from './vat-number.js';

describe('digit normalisation', () => {
  test('converts Arabic-Indic and Persian digits to Latin', () => {
    expect(toLatinDigits('١٢٣٤')).toBe('1234');
    expect(toLatinDigits('۱۲۳۴')).toBe('1234');
    expect(toLatinDigits('٠٥٠١٢٣٤٥٦٧')).toBe('0501234567');
  });

  test('leaves non-digits alone', () => {
    expect(toLatinDigits('ا ب ح ١٢٣٤')).toBe('ا ب ح 1234');
  });

  test('digitsOnly strips everything else', () => {
    expect(digitsOnly('+966 50 123 4567')).toBe('966501234567');
    expect(digitsOnly('٠٥٠-١٢٣-٤٥٦٧')).toBe('0501234567');
  });
});

describe('Saudi IBAN', () => {
  // Published example from SAMA's IBAN documentation.
  const VALID = 'SA0380000000608010167519';

  test('accepts a valid IBAN in any formatting or script', () => {
    expect(isValidSaudiIban(VALID)).toBe(true);
    expect(isValidSaudiIban('SA03 8000 0000 6080 1016 7519')).toBe(true);
    expect(isValidSaudiIban('sa03 8000 0000 6080 1016 7519')).toBe(true);
  });

  test('mod-97 catches a transposition that length checks miss', () => {
    // Swap two adjacent digits — still 24 chars, still SA, still numeric.
    const transposed = 'SA0380000000608010165719';
    expect(transposed.length).toBe(VALID.length);
    expect(isValidSaudiIban(transposed)).toBe(false);
    expect(validateSaudiIban(transposed)).toMatchObject({ error: 'bad_checksum' });
  });

  test('rejects wrong country and wrong length', () => {
    expect(validateSaudiIban('GB33BUKB20201555555555')).toMatchObject({ error: 'bad_country' });
    expect(validateSaudiIban('SA038000000060801016')).toMatchObject({ error: 'bad_length' });
  });

  test('formats and masks for display', () => {
    expect(formatIban(VALID)).toBe('SA03 8000 0000 6080 1016 7519');
    expect(maskIban(VALID)).toBe('SA03 •••• •••• •••• •••• 7519');
    expect(maskIban(VALID)).not.toContain('80000000');
  });
});

describe('National ID and Iqama', () => {
  test('distinguishes national from iqama by prefix', () => {
    // Checksum-valid samples generated with the documented algorithm.
    const national = validateNationalId('1000000008');
    expect(national).toMatchObject({ ok: true, kind: 'national' });

    const iqama = validateNationalId('2000000006');
    expect(iqama).toMatchObject({ ok: true, kind: 'iqama' });
  });

  test('rejects bad prefix, length, and checksum', () => {
    expect(validateNationalId('3000000000')).toMatchObject({ error: 'bad_prefix' });
    expect(validateNationalId('100000000')).toMatchObject({ error: 'bad_length' });
    expect(validateNationalId('1000000000')).toMatchObject({ error: 'bad_checksum' });
  });

  test('accepts Arabic-Indic input', () => {
    expect(validateNationalId('١٠٠٠٠٠٠٠٠٨')).toMatchObject({ ok: true });
  });

  test('masking leaves only first and last digit', () => {
    expect(maskNationalId('1000000008')).toBe('1••••••••8');
  });
});

describe('Saudi phone', () => {
  test('every spelling of one number normalises to a single E.164 identity', () => {
    // profiles.phone is unique and is the login identity — two spellings must
    // never become two accounts.
    const forms = [
      '0501234567',
      '501234567',
      '+966501234567',
      '00966501234567',
      '966501234567',
      '٠٥٠١٢٣٤٥٦٧',
      '+966 50 123 4567',
      '050-123-4567',
    ];

    for (const form of forms) {
      const result = parseSaudiPhone(form);
      expect(result.ok, form).toBe(true);
      if (!result.ok) continue;
      expect(result.e164, form).toBe('+966501234567');
      expect(result.national, form).toBe('0501234567');
    }
  });

  test('rejects landlines and malformed numbers', () => {
    expect(parseSaudiPhone('0112345678')).toMatchObject({ error: 'not_saudi_mobile' });
    expect(parseSaudiPhone('05012345')).toMatchObject({ error: 'bad_length' });
    expect(parseSaudiPhone('')).toMatchObject({ error: 'empty' });
  });

  test('masking is safe for push notification bodies', () => {
    expect(maskPhone('0501234567')).toBe('050•••••67');
  });
});

describe('VAT number', () => {
  test('accepts 15 digits starting and ending with 3', () => {
    expect(validateVatNumber('300000000000003')).toMatchObject({ ok: true });
  });

  test('rejects wrong prefix, suffix, or length', () => {
    expect(validateVatNumber('100000000000003')).toMatchObject({ error: 'bad_prefix' });
    expect(validateVatNumber('300000000000001')).toMatchObject({ error: 'bad_suffix' });
    expect(validateVatNumber('30000000000003')).toMatchObject({ error: 'bad_length' });
  });
});
