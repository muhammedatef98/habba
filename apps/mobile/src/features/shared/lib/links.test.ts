import { describe, expect, test } from 'vitest';
import { openableLink, splitTagged } from './links.js';

describe('openableLink', () => {
  test('an https link opens', () => {
    expect(openableLink('https://habba.sa/privacy')).toBe('https://habba.sa/privacy');
    expect(openableLink('  https://habba.sa/terms ')).toBe('https://habba.sa/terms');
  });

  test('anything else does not', () => {
    for (const value of [
      '',
      'http://habba.sa/privacy',
      'javascript:alert(1)',
      'https://',
      'habba.sa/terms',
      'tel:+966500000000',
      'https://habba sa',
    ]) {
      expect(openableLink(value), value).toBeNull();
    }
  });
});

describe('splitTagged', () => {
  test('keeps each language its own order', () => {
    expect(
      splitTagged('بالمتابعة فإنك توافق على <terms>الشروط</terms> و<privacy>الخصوصية</privacy>.'),
    ).toEqual([
      { text: 'بالمتابعة فإنك توافق على ', tag: null },
      { text: 'الشروط', tag: 'terms' },
      { text: ' و', tag: null },
      { text: 'الخصوصية', tag: 'privacy' },
      { text: '.', tag: null },
    ]);
  });

  test('plain text is one plain run', () => {
    expect(splitTagged('no links here')).toEqual([{ text: 'no links here', tag: null }]);
  });

  test('an unclosed tag stays as text', () => {
    expect(splitTagged('see <terms>the terms')).toEqual([
      { text: 'see <terms>the terms', tag: null },
    ]);
  });
});
