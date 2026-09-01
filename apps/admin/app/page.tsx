/**
 * Provider verification queue.
 *
 * The first screen of §9.4's console, and the one that unblocks everything
 * else: `match_providers` will not consider a provider who is not `approved`,
 * so until somebody can approve them the dispatch system cannot run at all.
 *
 * Every decision here goes through `set_provider_verification` (0045), which
 * writes the status and the reason in one transaction and refuses a rejection
 * with no stated reason. The form asks for that reason before submitting
 * rather than surfacing the server's refusal afterwards — an operator should
 * be told the rule, not discover it.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { isLive, opsRepository } from '@/data/ops-repository';
import type { ProviderReview, VerificationStatus } from '@/data/types';

const QUEUES: readonly { readonly status: VerificationStatus; readonly label: string }[] = [
  { status: 'pending', label: 'بانتظار المراجعة' },
  { status: 'in_review', label: 'قيد المراجعة' },
  { status: 'approved', label: 'معتمدون' },
  { status: 'rejected', label: 'مرفوضون' },
  { status: 'suspended', label: 'موقوفون' },
];

export default function VerificationQueue() {
  const [queue, setQueue] = useState<VerificationStatus>('pending');
  const [providers, setProviders] = useState<readonly ProviderReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProviders(await opsRepository.listProvidersForReview(queue));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل القائمة');
    } finally {
      setLoading(false);
    }
  }, [queue]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-xl)' }}>
      <header style={{ marginBottom: 'var(--space-xl)' }}>
        <h1
          style={{
            fontSize: 'var(--text-2xl)',
            lineHeight: 'var(--leading-2xl)',
            fontWeight: 600,
            margin: 0,
          }}
        >
          مراجعة مقدّمي الخدمة
        </h1>
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-sm)',
            lineHeight: 'var(--leading-sm)',
            marginTop: 'var(--space-xs)',
          }}
        >
          الاعتماد يعني أن هبّة تضمن هذا الشخص أمام عميل ينتظره على الطريق. كل قرار يُسجَّل باسم من
          اتخذه.
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
            بيانات تجريبية — لم يُربط المشروع بقاعدة بيانات بعد. القرارات هنا لا تُحفظ.
          </p>
        ) : null}
      </header>

      <nav
        style={{
          display: 'flex',
          gap: 'var(--space-sm)',
          marginBottom: 'var(--space-lg)',
          flexWrap: 'wrap',
        }}
      >
        {QUEUES.map((entry) => {
          const active = entry.status === queue;
          return (
            <button
              key={entry.status}
              onClick={() => setQueue(entry.status)}
              style={{
                padding: 'var(--space-sm) var(--space-base)',
                borderRadius: 'var(--radius-full)',
                border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: active ? 'var(--color-primary-subtle)' : 'var(--color-surface)',
                color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                fontWeight: active ? 600 : 400,
                fontSize: 'var(--text-sm)',
              }}
            >
              {entry.label}
            </button>
          );
        })}
      </nav>

      {error !== null ? (
        <p style={{ color: 'var(--color-emergency-fg)' }}>{error}</p>
      ) : loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>
      ) : providers.length === 0 ? (
        <EmptyQueue />
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--space-md)',
          }}
        >
          {providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} onDecided={load} />
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyQueue() {
  return (
    <div
      style={{
        padding: 'var(--space-2xl)',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        border: '1px dashed var(--color-border-strong)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      لا أحد في هذه القائمة.
    </div>
  );
}

function ProviderRow({
  provider,
  onDecided,
}: {
  readonly provider: ProviderReview;
  readonly onDecided: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // The server refuses these without a reason (0045). Asking here means the
  // operator is told the rule rather than discovering it from a failure.
  const needsNote = (status: VerificationStatus) => status === 'rejected' || status === 'suspended';

  const decide = async (status: VerificationStatus) => {
    if (needsNote(status) && note.trim() === '') {
      setFailure('اكتب السبب أولاً — يُعرض على مقدّم الخدمة وله حق الاعتراض.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await opsRepository.setVerification(provider.id, status, note.trim() || undefined);
      onDecided();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'تعذّر حفظ القرار');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface)',
        padding: 'var(--space-base)',
        display: 'grid',
        gap: 'var(--space-md)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-base)',
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 'var(--text-lg)', lineHeight: 'var(--leading-lg)' }}>
          {provider.businessNameAr}
        </strong>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          {provider.providerType === 'workshop' ? 'ورشة' : 'فنّي'}
          {provider.cityNameAr !== null ? ` · ${provider.cityNameAr}` : ''}
        </span>

        {/* Nafath is an external fact, not a Habba judgement. Showing its
            absence plainly is the point — approving without it is a decision
            the operator should be making knowingly. */}
        <span
          style={{
            marginInlineStart: 'auto',
            fontSize: 'var(--text-xs)',
            padding: '4px var(--space-sm)',
            borderRadius: 'var(--radius-full)',
            background:
              provider.nafathVerifiedAt !== null
                ? 'var(--color-success-subtle)'
                : 'var(--color-warning-subtle)',
            color:
              provider.nafathVerifiedAt !== null
                ? 'var(--color-success-fg)'
                : 'var(--color-warning-fg)',
          }}
        >
          {provider.nafathVerifiedAt !== null ? 'نفاذ موثّق' : 'بدون توثيق نفاذ'}
        </span>
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="السبب — إلزامي عند الرفض أو الإيقاف"
        rows={2}
        style={{
          width: '100%',
          padding: 'var(--space-sm)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-background)',
          color: 'var(--color-text)',
          resize: 'vertical',
        }}
      />

      {failure !== null ? (
        <p style={{ color: 'var(--color-emergency-fg)', fontSize: 'var(--text-sm)', margin: 0 }}>
          {failure}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        <Action label="اعتماد" tone="primary" busy={busy} onClick={() => void decide('approved')} />
        <Action
          label="قيد المراجعة"
          tone="neutral"
          busy={busy}
          onClick={() => void decide('in_review')}
        />
        <Action label="رفض" tone="danger" busy={busy} onClick={() => void decide('rejected')} />
        <Action label="إيقاف" tone="danger" busy={busy} onClick={() => void decide('suspended')} />
      </div>
    </li>
  );
}

function Action({
  label,
  tone,
  busy,
  onClick,
}: {
  readonly label: string;
  readonly tone: 'primary' | 'neutral' | 'danger';
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  // Destructive actions are outlined rather than filled — §8's rule that red is
  // reserved, applied here so a queue of four buttons does not read as an
  // alarm.
  const styles: Record<typeof tone, { background: string; color: string; border: string }> = {
    primary: {
      background: 'var(--color-primary)',
      color: 'var(--color-primary-text)',
      border: 'var(--color-primary)',
    },
    neutral: {
      background: 'transparent',
      color: 'var(--color-text)',
      border: 'var(--color-border-strong)',
    },
    danger: {
      background: 'transparent',
      color: 'var(--color-emergency-fg)',
      border: 'var(--color-emergency-fg)',
    },
  };
  const style = styles[tone];

  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        minHeight: 44,
        padding: '0 var(--space-base)',
        borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${style.border}`,
        background: style.background,
        color: style.color,
        fontWeight: 600,
        fontSize: 'var(--text-sm)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}
