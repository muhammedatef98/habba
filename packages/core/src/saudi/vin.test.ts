import { describe, expect, test } from 'vitest';
import { isValidVin, normaliseVin, vinProblem, VIN_LENGTH } from './vin.js';

describe('normaliseVin', () => {
  test('upper-cases and strips what people paste in', () => {
    expect(normaliseVin(' 5hgbh41jx-mn109186 ')).toBe('5HGBH41JXMN109186');
  });

  test('never substitutes an ambiguous letter for a digit', () => {
    // Guessing at a character in the key a car's entire history hangs on is
    // worse than refusing it: the wrong VIN silently opens the wrong logbook.
    expect(normaliseVin('IOQ')).toBe('IOQ');
  });
});

describe('vinProblem', () => {
  test('accepts a real VIN', () => {
    expect(vinProblem('5HGBH41JXMN109186')).toBeNull();
    expect(isValidVin('5HGBH41JXMN109186')).toBe(true);
  });

  test('an empty field is empty, not invalid', () => {
    // The plate may have been entered instead. "Required" and "wrong" are
    // different sentences and the screen says different things for each.
    expect(vinProblem('   ')).toBe('empty');
  });

  test('names the ambiguous letters as their own mistake', () => {
    // I, O and Q are left out of ISO 3779 because they cannot be told from 1
    // and 0 stamped into metal, so a VIN containing one has been misread —
    // which is a different instruction from "that character is not allowed".
    expect(vinProblem('5HGBH41JXMN10918O')).toBe('ambiguous_letter');
    expect(vinProblem('IHGBH41JXMN109186')).toBe('ambiguous_letter');
    expect(vinProblem('5HGBH41JXMN10918Q')).toBe('ambiguous_letter');
  });

  test('rejects the wrong length', () => {
    expect(vinProblem('5HGBH41JX')).toBe('length');
    expect(vinProblem('5HGBH41JXMN1091867')).toBe('length');
    expect(VIN_LENGTH).toBe(17);
  });

  test('rejects anything outside the alphabet', () => {
    expect(vinProblem('5HGBH41JXMN10918#')).toBe('charset');
  });

  test('agrees with the database constraint on the whole alphabet', () => {
    // Same expression as `vin_format` in 0005 and `inspection_vin_format` in
    // 0026. A client that accepted a character the column refuses would fail
    // the inspector after the car has gone.
    const constraint = /^[A-HJ-NPR-Z0-9]{17}$/;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    for (const character of alphabet) {
      const candidate = character.repeat(VIN_LENGTH);
      expect(isValidVin(candidate), candidate).toBe(constraint.test(candidate));
    }
  });
});
