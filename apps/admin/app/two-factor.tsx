/**
 * The second factor — mandatory for every operator (CLAUDE.md §5.1.6).
 *
 * Two shapes of the same step. The first time: set up an authenticator app
 * from a QR code (or the secret, typed in), then prove it works with a code.
 * Every time after, and again whenever the eight hours are up: the code.
 *
 * Not skippable, and there is nothing to skip to: until this succeeds the
 * server's is_ops() is false (0068), so the console would load and show
 * nothing.
 */

'use client';

import { useState } from 'react';
import { opsAuth, type OpsState } from '@/lib/ops-session';

type Pending = Extract<OpsState, { stage: 'enrol' | 'verify' }>;

export function TwoFactor({
  state,
  onProgress,
  onCancel,
}: {
  readonly state: Pending;
  readonly onProgress: (state: OpsState) => void;
  readonly onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const factorId = state.stage === 'enrol' ? state.enrolment.factorId : state.factorId;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await opsAuth.verify(factorId, code);
    setBusy(false);
    if (result.ok) {
      onProgress(result.state);
      return;
    }
    setCode('');
    setError(
      result.reason === 'bad_code'
        ? 'الرمز غير صحيح أو انتهت صلاحيته. أدخل الرمز الظاهر الآن في التطبيق.'
        : 'تعذّر الاتصال. حاول مرة أخرى.',
    );
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-lg)',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 420,
          display: 'grid',
          gap: 'var(--space-base)',
          padding: 'var(--space-xl)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-surface)',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--text-xl)',
              lineHeight: 'var(--leading-xl)',
              fontWeight: 600,
            }}
          >
            {state.stage === 'enrol' ? 'إعداد التحقّق بخطوتين' : 'التحقّق بخطوتين'}
          </h1>
          <p
            style={{
              margin: 'var(--space-xs) 0 0',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {state.stage === 'enrol'
              ? 'التحقّق بخطوتين إلزامي لكل حسابات لوحة التشغيل. امسح الرمز بتطبيق مصادقة مثل Google Authenticator أو Microsoft Authenticator، ثم أدخل الرمز المكوّن من ٦ أرقام.'
              : 'أدخل الرمز المكوّن من ٦ أرقام من تطبيق المصادقة. يُطلب مرة كل ٨ ساعات.'}
          </p>
        </div>

        {state.stage === 'enrol' ? (
          <div style={{ display: 'grid', gap: 'var(--space-sm)', justifyItems: 'center' }}>
            {state.enrolment.qrCode !== null ? (
              <img
                src={state.enrolment.qrCode}
                alt="رمز QR لإعداد تطبيق المصادقة"
                width={180}
                height={180}
                style={{ background: '#fff', borderRadius: 'var(--radius-md)', padding: 8 }}
              />
            ) : null}
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              أو أدخل هذا المفتاح يدوياً:
            </p>
            <code
              dir="ltr"
              style={{
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-xs) var(--space-sm)',
                background: 'var(--color-surface-sunken)',
                borderRadius: 'var(--radius-sm)',
                wordBreak: 'break-all',
                userSelect: 'all',
              }}
            >
              {state.enrolment.secret}
            </code>
          </div>
        ) : null}

        <label style={{ display: 'grid', gap: 'var(--space-xs)' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>رمز التحقّق</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            dir="ltr"
            style={{
              padding: 'var(--space-sm) var(--space-md)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-background)',
              color: 'var(--color-text)',
              minHeight: 48,
              fontSize: 'var(--text-lg)',
              letterSpacing: '0.3em',
              textAlign: 'center',
            }}
          />
        </label>

        {error !== null ? (
          <p style={{ margin: 0, color: 'var(--color-emergency-fg)', fontSize: 'var(--text-sm)' }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || code.length !== 6}
          style={{
            minHeight: 48,
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-text)',
            fontWeight: 600,
            opacity: busy || code.length !== 6 ? 0.6 : 1,
          }}
        >
          {busy ? 'جارٍ التحقّق…' : 'تحقّق'}
        </button>

        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-link)',
            fontWeight: 600,
            fontSize: 'var(--text-sm)',
            minHeight: 44,
          }}
        >
          تسجيل الخروج
        </button>
      </form>
    </main>
  );
}
