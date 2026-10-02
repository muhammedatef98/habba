/**
 * Turning audit rows into something an operator can read.
 */

import type { AuditEntry } from './types';

/**
 * What an entry changed, field by field. The log keeps whole rows; an
 * operator scanning it wants "verification_status: pending → approved", not
 * two thirty-column objects to compare by eye. Housekeeping columns that
 * change on every write are left out.
 */
export function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditEntry['changes'] {
  const ignored = new Set(['updated_at', 'created_at']);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: { field: string; from: string | null; to: string | null }[] = [];

  for (const field of keys) {
    if (ignored.has(field)) continue;
    const from = before?.[field];
    const to = after?.[field];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ field, from: show(from), to: show(to) });
  }
  return changes;
}

function show(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * PostgREST serialises an interval as `HH:MM:SS` (with days prefixed once it
 * passes one). Parsed here rather than sent as seconds from SQL, because the
 * interval is the honest type for "how long has this been stuck" and the
 * board is the only thing that needs it as a number.
 */
export function intervalToSeconds(value: string): number {
  const days = /(\d+) days?/.exec(value);
  const clock = /(\d+):(\d{2}):(\d{2})/.exec(value);
  const fromDays = days !== null ? Number(days[1]) * 86_400 : 0;
  if (clock === null) return fromDays;
  return fromDays + Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Math.floor(Number(clock[3]));
}
