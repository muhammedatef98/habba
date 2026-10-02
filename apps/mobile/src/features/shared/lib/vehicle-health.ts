/**
 * How صحة السيارة is drawn: the ring's colour per grade, and the month label
 * under a cost bar. The score itself is the server's (0097); nothing here
 * recomputes it.
 */

import type { HealthGrade } from '@habba/core';
import type { ScoreTone } from '@habba/ui';

/**
 * Never red. A car with an overdue oil change needs attention, not an
 * ambulance, and §8 keeps red for genuine emergencies.
 */
export function toneForGrade(grade: HealthGrade): ScoreTone {
  switch (grade) {
    case 'excellent':
      return 'success';
    case 'good':
      return 'primary';
    case 'fair':
    case 'attention':
      return 'warning';
    case 'unknown':
      return 'muted';
  }
}

/** "سبت" style short month for a `YYYY-MM` key, Latin digits never needed. */
export function shortMonth(key: string, locale: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  // Mid-month at noon UTC: no timezone can push it into a neighbouring month.
  const date = new Date(Date.UTC(year, month - 1, 15, 12));
  return date.toLocaleDateString(locale.startsWith('ar') ? 'ar-u-ca-gregory-nu-latn' : locale, {
    month: 'short',
  });
}
