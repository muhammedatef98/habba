/**
 * سجلّ التدقيق — every ops write, newest first.
 *
 * Amendment B §5.1.6: "Every admin action writes an immutable audit row." That
 * has been true since 0070 — a definer trigger on fifteen tables, with no
 * insert, update or delete policy for anyone, so the rows cannot be edited or
 * removed even by the process that writes them.
 *
 * ⚠️ And nothing read them. A log written by a trigger and read by nobody is
 * an obligation discharged on paper: it satisfies the rule and answers no
 * question, because the moment anyone actually needs it — a provider disputing
 * a suspension, an operator who says they did not do a thing — the only way in
 * is a psql session against production. This screen is the way in.
 *
 * **Read-only, and structurally so.** There is no action on this page and
 * there is no code here that could add one: `OpsRepository` exposes exactly
 * `listAuditLog`, and the table has no write policy to call. A log a console
 * can amend is not a log.
 *
 * **What is shown, and what is not.** The columns that changed, never the full
 * row. 0070 is explicit about why: a before/after of `providers` would copy
 * `national_id_encrypted` and `iban_encrypted` into a table with different
 * access rules on every edit, turning the audit trail into a second and less
 * guarded copy of the KYC vault. Knowing that `verification_status` moved is
 * the audit; the value lives in the table it belongs to.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { opsRepository } from '@/data/ops-repository';
import type { AuditEntry } from '@/data/types';

/**
 * How many rows to read.
 *
 * Deliberately a page rather than everything: this table only grows, and a
 * console that tried to render a year of it would hang on the one day somebody
 * urgently needs to read the last hour.
 */
const PAGE = 200;

const ACTION_LABEL: Readonly<Record<string, string>> = {
  INSERT: 'إنشاء',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
};

export function AuditLog() {
  const [rows, setRows] = useState<readonly AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await opsRepository.listAuditLog(PAGE));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل السجلّ');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown =
    rows === null
      ? null
      : filter.trim() === ''
        ? rows
        : rows.filter(
            (row) =>
              row.targetTable.includes(filter.trim()) ||
              (row.targetId ?? '').includes(filter.trim()),
          );

  return (
    <section>
      <header style={{ marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>سجلّ التدقيق</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          كل كتابة من لوحة التشغيل، بترتيب زمني عكسي. السجلّ للقراءة فقط — لا يمكن تعديله ولا حذفه
          من هنا ولا من أي مكان آخر.
        </p>
      </header>

      {error !== null ? (
        <p
          role="alert"
          style={{
            padding: 'var(--space-md)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-emergency-subtle)',
            color: 'var(--color-emergency-fg)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {error}
        </p>
      ) : null}

      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="تصفية بالجدول أو المعرّف"
        style={{
          padding: 'var(--space-sm) var(--space-md)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border-strong)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          fontSize: 'var(--text-sm)',
          minHeight: 44,
          width: '100%',
          maxWidth: 360,
          marginBottom: 'var(--space-base)',
        }}
      />

      {shown === null ? (
        <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>
      ) : shown.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          {rows !== null && rows.length > 0 ? 'لا نتائج لهذه التصفية.' : 'لا توجد سجلات بعد.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
          {shown.map((row) => (
            <article
              key={row.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-md)',
                background: 'var(--color-surface)',
                display: 'grid',
                gap: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-md)',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                }}
              >
                <strong style={{ fontSize: 'var(--text-sm)' }}>
                  {ACTION_LABEL[row.action] ?? row.action} · {row.targetTable}
                </strong>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-subtle)',
                    fontFamily: 'var(--font-latin)',
                  }}
                  dir="ltr"
                >
                  {new Date(row.at).toISOString().replace('T', ' ').slice(0, 19)}
                </span>
              </div>

              {/* ⚠️ Says WHO, including when the answer is "nobody". 0070 makes
                  `actor_id` nullable on purpose: the dispatch tick and the
                  maintenance sweep have no `auth.uid()`. Rendering those as a
                  blank would read as a missing name rather than as a machine,
                  and "which of my operators did this" is the question this log
                  exists to answer. */}
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {row.actorId === null ? (
                  'إجراء آلي من الخادم'
                ) : (
                  <>
                    <span dir="ltr">{row.actorId}</span>
                    {row.actorRole !== null ? ` · ${row.actorRole}` : ''}
                    {row.ip !== null ? (
                      <>
                        {' · '}
                        <span dir="ltr">{row.ip}</span>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              {row.targetId !== null ? (
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-subtle)',
                    fontFamily: 'var(--font-latin)',
                  }}
                  dir="ltr"
                >
                  {row.targetId}
                </div>
              ) : null}

              {row.changedColumns.length > 0 ? (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  الأعمدة المتغيّرة:{' '}
                  <span dir="ltr" style={{ fontFamily: 'var(--font-latin)' }}>
                    {row.changedColumns.join(', ')}
                  </span>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
