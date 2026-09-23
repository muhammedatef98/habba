/**
 * The audit log: every change an operator has made (0068).
 *
 * Read-only by construction — the table refuses updates and deletes to
 * everyone, the owner included — so there is nothing here to act on. It is
 * the answer to "who approved this technician?" and "who changed this price,
 * from what, and when?", which is the whole reason §5.1.6 asks for it.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { opsRepository } from '@/data/ops-repository';
import type { AuditEntry } from '@/data/types';

const TABLE_LABEL: Readonly<Record<string, string>> = {
  providers: 'مقدّم خدمة',
  orders: 'طلب',
  services: 'خدمة',
  payouts: 'دفعة مستحقات',
  user_roles: 'صلاحية',
  commission_rates: 'نسبة عمولة',
  cities: 'مدينة',
  vehicle_timeline: 'دفتر سيارة',
};

const ACTION_LABEL: Readonly<Record<AuditEntry['action'], string>> = {
  insert: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
};

export function AuditLog() {
  const [entries, setEntries] = useState<readonly AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await opsRepository.listAuditLog(200));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <p style={{ color: 'var(--color-emergency-fg)' }}>
        تعذّر تحميل السجلّ. تحقّق من الاتصال وحاول مرة أخرى.{' '}
        <button onClick={() => void load()} style={linkButton}>
          إعادة المحاولة
        </button>
      </p>
    );
  }

  if (entries === null) return <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>;

  if (entries.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>لا تغييرات مسجّلة بعد.</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
      {entries.map((entry) => (
        <article
          key={entry.id}
          style={{
            padding: 'var(--space-md)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            display: 'grid',
            gap: 'var(--space-xs)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-sm)',
              alignItems: 'baseline',
            }}
          >
            <strong>{entry.actorName}</strong>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {ACTION_LABEL[entry.action]} {TABLE_LABEL[entry.targetTable] ?? entry.targetTable}
            </span>
            <code
              dir="ltr"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}
            >
              {entry.targetId}
            </code>
            <span
              dir="ltr"
              style={{
                marginInlineStart: 'auto',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
              }}
            >
              {new Date(entry.at).toLocaleString('ar-u-nu-latn', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {entry.ip !== null ? ` · ${entry.ip}` : ''}
            </span>
          </div>
          {entry.changes.length > 0 ? (
            <ul
              style={{
                margin: 0,
                paddingInlineStart: 'var(--space-lg)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {entry.changes.slice(0, 8).map((change) => (
                <li key={change.field}>
                  <code dir="ltr">{change.field}</code>:{' '}
                  <span dir="ltr">
                    {change.from ?? '—'} → {change.to ?? '—'}
                  </span>
                </li>
              ))}
              {entry.changes.length > 8 ? <li>و{entry.changes.length - 8} حقول أخرى</li> : null}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

const linkButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-link)',
  fontWeight: 600,
  cursor: 'pointer',
};
