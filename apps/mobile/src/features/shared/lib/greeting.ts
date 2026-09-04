/**
 * Which greeting the home screen opens with.
 *
 * Split at prayer-adjacent boundaries rather than the Western 12/18 because
 * that is how the day is actually described in Saudi Arabic: صباح الخير runs
 * until the afternoon, مساء الخير from then until people turn in. The late
 * band exists because "good evening" at 2am reads as a bug, and a meaningful
 * share of this app's traffic is at 2am — that is what an emergency service is.
 *
 * Pure and hour-in, key-out so it can be tested without freezing the clock.
 */

export type GreetingKey = 'greetingMorning' | 'greetingEvening' | 'greetingNight';

/** @param hour local hour, 0–23. */
export function greetingKeyForHour(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return 'greetingMorning';
  if (hour >= 12 && hour < 22) return 'greetingEvening';
  return 'greetingNight';
}

export function greetingKeyNow(now: Date = new Date()): GreetingKey {
  return greetingKeyForHour(now.getHours());
}
