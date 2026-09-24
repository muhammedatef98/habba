/**
 * The audit log: every change an operator has made, and every file they
 * opened (0068, 0069, 0070).
 *
 * Read-only by construction — the table refuses updates and deletes to
 * everyone, the owner included — so there is nothing here to act on. It is
 * the answer to "who approved this technician?", "who changed this price, from
 * what, and when?" and "who looked at this customer's file?".
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import { dateTime } from '@/lib/format';
import { AUDIT_ACTION, TABLE_NAME } from '../labels';
import { Badge, Field, Loadable, PageHead, useLoad } from '../ui';

export function AuditSection() {
  const [table, setTable] = useState('');
  const [limit, setLimit] = useState(200);
  const state = useLoad(() => api.auditLog(limit, table), `${table}|${limit}`);

  return (
    <>
      <PageHead
        title="سجلّ التدقيق"
        description="كل تغيير أجراه أحد من الفريق، وكل ملف شخص فُتح — من، وماذا، ومن أين، ومتى. لا يمكن لأحد تعديله أو حذفه."
      />
      <div className="toolbar">
        <Field label="الجدول">
          <select
            className="input"
            value={table}
            onChange={(event) => setTable(event.target.value)}
          >
            <option value="">الكل</option>
            {Object.entries(TABLE_NAME).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </Field>
        <Field label="العدد">
          <select
            className="input"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            <option value={200}>آخر 200</option>
            <option value={1000}>آخر 1000</option>
          </select>
        </Field>
      </div>
      <Loadable state={state}>
        {(entries) =>
          entries.length === 0 ? (
            <div className="empty">لا تغييرات مسجّلة بعد.</div>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
              {entries.map((entry) => (
                <article key={entry.id} className="card" style={{ padding: 'var(--space-md)' }}>
                  <div className="actions" style={{ alignItems: 'baseline' }}>
                    <strong>{entry.actorName}</strong>
                    <Badge
                      tone={
                        entry.action === 'delete'
                          ? 'bad'
                          : entry.action === 'read'
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {AUDIT_ACTION[entry.action] ?? entry.action}
                    </Badge>
                    <span className="muted">
                      {TABLE_NAME[entry.targetTable] ?? entry.targetTable}
                    </span>
                    <code dir="ltr" className="subtle">
                      {entry.targetId}
                    </code>
                    <span
                      dir="ltr"
                      className="subtle numeric"
                      style={{ marginInlineStart: 'auto' }}
                    >
                      {dateTime(entry.at)}
                      {entry.ip !== null ? ` · ${entry.ip}` : ''}
                    </span>
                  </div>
                  {entry.action !== 'read' && entry.changes.length > 0 ? (
                    <ul
                      style={{
                        margin: 'var(--space-xs) 0 0',
                        paddingInlineStart: 'var(--space-lg)',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      {entry.changes.slice(0, 10).map((change) => (
                        <li key={change.field}>
                          <code dir="ltr">{change.field}</code>:{' '}
                          <span dir="ltr">
                            {change.from ?? '—'} → {change.to ?? '—'}
                          </span>
                        </li>
                      ))}
                      {entry.changes.length > 10 ? (
                        <li>و{entry.changes.length - 10} حقول أخرى</li>
                      ) : null}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          )
        }
      </Loadable>
    </>
  );
}
