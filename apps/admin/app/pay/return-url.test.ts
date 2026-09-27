import { describe, expect, test } from 'vitest';
import { appReturnUrl } from './return-url';

describe('appReturnUrl', () => {
  test('hands the result on to the app', () => {
    expect(appReturnUrl('habba://pay-return', { id: 'pay_12345678', status: 'authorized' })).toBe(
      'habba://pay-return?id=pay_12345678&status=authorized',
    );
    expect(
      appReturnUrl('exp://192.168.1.5:8081/--/pay-return', { status: 'failed', message: 'رفض' }),
    ).toBe(
      `exp://192.168.1.5:8081/--/pay-return?status=failed&message=${encodeURIComponent('رفض').replace(/%20/g, '+')}`,
    );
  });

  test('never redirects to the web or anywhere else it is told to', () => {
    expect(appReturnUrl('https://evil.example/steal', { id: 'pay_12345678' })).toBeNull();
    expect(appReturnUrl('javascript:alert(1)', {})).toBeNull();
    expect(appReturnUrl(undefined, {})).toBeNull();
  });

  test("drops values that are not shaped like Moyasar's", () => {
    expect(
      appReturnUrl('habba://pay-return', { id: '../../x', status: 'Authorized<script>' }),
    ).toBe('habba://pay-return');
  });
});
