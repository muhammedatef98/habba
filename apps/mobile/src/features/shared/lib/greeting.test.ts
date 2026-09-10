import { describe, expect, it } from 'vitest';
import { greetingKeyForHour, greetingKeyNow } from './greeting.js';

describe('greetingKeyForHour', () => {
  it('greets the morning from dawn until noon', () => {
    expect(greetingKeyForHour(5)).toBe('greetingMorning');
    expect(greetingKeyForHour(11)).toBe('greetingMorning');
  });

  it('switches to the evening greeting at noon, not at 18:00', () => {
    expect(greetingKeyForHour(12)).toBe('greetingEvening');
    expect(greetingKeyForHour(21)).toBe('greetingEvening');
  });

  it('uses the late greeting overnight, when emergencies actually happen', () => {
    expect(greetingKeyForHour(22)).toBe('greetingNight');
    expect(greetingKeyForHour(2)).toBe('greetingNight');
    expect(greetingKeyForHour(4)).toBe('greetingNight');
  });

  it('covers every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(greetingKeyForHour(hour)).toMatch(/^greeting/);
    }
  });
});

describe('greetingKeyNow', () => {
  it('reads the hour off the date it is given', () => {
    const threeInTheMorning = new Date(2026, 0, 1, 3, 0, 0);
    expect(greetingKeyNow(threeInTheMorning)).toBe('greetingNight');
  });
});
