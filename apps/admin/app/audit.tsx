/**
 * The audit trail.
 *
 * Amendment B (CLAUDE.md §5.1.6) requires every admin action to write an
 * immutable row. `audit_log` (0064) is that row; this is the only reason it is
 * worth writing. Accountability is not a property of a table — it is the fact
 * that a second operator can see what the first one did, and a table nobody in
 * this console can open is a table that gets read after the incident, by
 * whoever still has database access.
 *
 * Read-only by construction, not by restraint: `audit_log` has no write policy
 * and no write grant to any role, and `record_audit()` is reachable only from
 * inside a SECURITY DEFINER function. There is no control on this screen that
 * could edit or remove a row because there is no call it could make.
 *
 * What each row is FOR is the before/after pair. The `providers` row now says
 * `approved` and says nothing about what it said an hour ago, so a reinstated
 * suspension and a first approval are indistinguishable from the table — and
 * those are very different decisions to have made.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { isLive, opsRepository } from '@/data/ops-repository';
import type { AuditEntry } from '@/data/types';

/**
 * What each action was, in the words an operator uses.
 *
 * `action` is free text on purpose (0064): a new admin action is a new string
 * rather than a migration that must land before the feature it audits. So this
 * map is a courtesy and the raw string is the fallback — an action nobody has
 * translated yet must still appear, because the alternative is an audit screen
 * that silently omits the newest thing anyone did.
 */
const ACTION_AR: Record<string, string> = {
  'provider.approved': 'اعتماد مقدّم خدمة',
  'provider.rejected': 'رفض مقدّم خدمة',
  'provider.suspended': 'إيقاف مقدّم خدمة',
  'provider.in_review': 'بدء مراجعة مقدّم خدمة',
  'provider.pending': 'إعادة إلى قائمة الانتظار',
};

/** Actions that took something away. Coloured, because they are the ones re-read. */
const REMOVING = new Set(['provider.rejected', 'provider.suspended']);

function whenAr(iso: string): string {
  // Latin digits and a 24-hour clock — §8, and an operator correlating this
  // against a server log is reading one of those.
  return new Date(iso).toLocaleString('ar-SA-u-nu-latn-ca-gregory', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * The before/after pair as "was → now", per key.
 *
 * Only the keys that actually changed, plus anything the action added. A pair
 * rendered in full would put `is_online: false → false` next to the decision
 * that matters and make the operator find it.
 */
function changes(entry: AuditEntry): readonly { key: string; was: string; now: string }[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  return keys
    .map((key) => ({
      key,
      was: format(before[key]),
      now: format(after[key]),
    }))
    .filter((change) => change.was !== change.now);
}

function format(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AuditTrail() {
  const [entries, setEntries] = useState<readonly AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await opsRepository.listAuditLog());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل السجل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header style={{ marginBottom: 'var(--space-xl)' }}>
        <h1
          style={{
            fontSize: 'var(--text-2xl)',
            lineHeight: 'var(--leading-2xl)',
            fontWeight: 600,
            margin: 0,
          }}
        >
          سجل الإجراءات
        </h1>
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-sm)',
            lineHeight: 'var(--leading-sm)',
            marginTop: 'var(--space-xs)',
          }}
        >
          كل إجراء في هذه اللوحة يُكتب هنا، ولا يُعدَّل ولا يُحذف بعد كتابته. السجل للمراجعة، لا
          للتعديل.
        </p>

        {!isLive ? (
          <p
            style={{
              marginTop: 'var(--space-md)',
              padding: 'var(--space-md)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-warning-subtle)',
              color: 'var(--color-warning-fg)',
              fontSize: 'var(--text-sm)',
            }}
          >
            وضع التطوير: السجل محلي في المتصفّح، ويبدأ فارغاً حتى تتخذ إجراءً من صفحة المراجعة.
          </p>
        ) : null}
      </header>

      {loading ? <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p> : null}

      {error !== null ? <p style={{ color: 'var(--color-emergency-fg)' }}>{error}</p> : null}

      {!loading && error === null && entries.length === 0 ? (
        <div
          style={{
            padding: 'var(--space-2xl)',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            border: '1px dashed var(--color-border-strong)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          لا توجد إجراءات مسجّلة بعد.
        </div>
      ) : null}

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: 'var(--space-sm)',
        }}
      >
        {entries.map((entry) => {
          const removing = REMOVING.has(entry.action);
          const diff = changes(entry);

          return (
            <li
              key={entry.id}
              style={{
                padding: 'var(--space-md) var(--space-base)',
                border: '1px solid var(--color-border)',
                // Same treatment as the board: a coloured start edge rather
                // than a tinted row, so the text stays as readable as the rest.
                borderInlineStartWidth: removing ? 4 : 1,
                borderInlineStartColor: removing
                  ? 'var(--color-emergency-fg)'
                  : 'var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
                display: 'grid',
                gap: 'var(--space-xs)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--space-base)',
                  flexWrap: 'wrap',
                }}
              >
                <strong style={{ fontWeight: 600 }}>
                  {ACTION_AR[entry.action] ?? entry.action}
                </strong>
                <span
                  className="numeric"
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}
                >
                  {whenAr(entry.at)}
                </span>
              </div>

              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                {/* The name, never the id alone. An id answers nobody's
                    question, and a missing name is worth seeing rather than
                    filling in with "unknown". */}
                {entry.actorName ?? entry.actorId}
              </div>

              {diff.length > 0 ? (
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    fontSize: 'var(--text-sm)',
                    display: 'grid',
                    gap: 2,
                  }}
                >
                  {diff.map((change) => (
                    <li key={change.key} style={{ color: 'var(--color-text-muted)' }}>
                      {change.key}: <span>{change.was}</span> ← <span>{change.now}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div
                className="numeric"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}
              >
                {entry.targetTable}
                {entry.targetId === null ? '' : ` · ${entry.targetId}`}
                {/* Labelled as reported, every time it is shown. The schema
                    says it is evidence and never proof — the header it comes
                    from is client-supplied — and a bare IP on a screen is read
                    as a fact about where someone was. */}
                {entry.ip === null ? '' : ` · العنوان كما ورد: ${entry.ip}`}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
