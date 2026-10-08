/**
 * Setting a new password, after the reset email's link (ops-session).
 *
 * The link proves the inbox; the authenticator code proves the phone. Both
 * are asked for when the account has a second factor, so someone who gets
 * into an operator's email still cannot take over their console account.
 * Afterwards the session is ended: the operator signs in again with the new
 * password and the code, and the eight hours start from there.
 */

'use client';

import { useState } from 'react';
import { opsAuth, type OpsState } from '@/lib/ops-session';

const MIN_LENGTH = 10;

const MESSAGES = {
  bad_code: 'رمز التحقّق غير صحيح أو انتهت صلاحيته. أدخل الرمز الظاهر الآن في التطبيق.',
  weak_password: 'كلمة المرور ضعيفة. استخدم كلمة أطول تجمع حروفاً وأرقاماً.',
  same_password: 'كلمة المرور الجديدة مطابقة للقديمة. اختر كلمة مختلفة.',
  transport_failed: 'تعذّر حفظ كلمة المرور. حاول مرة أخرى، أو اطلب رابطاً جديداً.',
} as const;

export function Recover({
  state,
  onDone,
  onCancel,
}: {
  readonly state: Extract<OpsState, { stage: 'recover' }>;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsCode = state.factorId !== null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_LENGTH) {
      setError(`كلمة المرور ${MIN_LENGTH} أحرف على الأقل.`);
      return;
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await opsAuth.completeRecovery(state.factorId, code, password);
    setBusy(false);
    if (result.ok) {
      onDone();
      return;
    }
    if (result.reason === 'bad_code') setCode('');
    setError(MESSAGES[result.reason]);
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
          maxWidth: 400,
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
            كلمة مرور جديدة
          </h1>
          <p
            style={{
              margin: 'var(--space-xs) 0 0',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {needsCode
              ? 'اختر كلمة مرور جديدة، وأدخل الرمز من تطبيق المصادقة لتأكيد أنك صاحب الحساب.'
              : 'اختر كلمة مرور جديدة لحسابك.'}
          </p>
        </div>

        <label style={labelStyle}>
          <span style={labelTextStyle}>كلمة المرور الجديدة</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
            autoFocus
            dir="ltr"
            style={fieldStyle}
          />
          <small style={{ color: 'var(--color-text-muted)' }}>{MIN_LENGTH} أحرف على الأقل.</small>
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>تأكيد كلمة المرور</span>
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
            dir="ltr"
            style={fieldStyle}
          />
        </label>

        {needsCode ? (
          <label style={labelStyle}>
            <span style={labelTextStyle}>رمز التحقّق</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              dir="ltr"
              style={{ ...fieldStyle, letterSpacing: '0.3em', textAlign: 'center' }}
            />
          </label>
        ) : null}

        {error !== null ? (
          <p style={{ margin: 0, color: 'var(--color-emergency-fg)', fontSize: 'var(--text-sm)' }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || (needsCode && code.length !== 6)}
          style={{
            minHeight: 48,
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-text)',
            fontWeight: 600,
            opacity: busy || (needsCode && code.length !== 6) ? 0.6 : 1,
          }}
        >
          {busy ? 'جارٍ الحفظ…' : 'احفظ كلمة المرور'}
        </button>

        <button
          type="button"
          onClick={onCancel}
          style={{
            justifySelf: 'center',
            minHeight: 44,
            border: 'none',
            background: 'none',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
          }}
        >
          إلغاء
        </button>
      </form>
    </main>
  );
}

const labelStyle: React.CSSProperties = { display: 'grid', gap: 'var(--space-xs)' };
const labelTextStyle: React.CSSProperties = { fontSize: 'var(--text-sm)', fontWeight: 600 };
const fieldStyle: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-md)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-background)',
  color: 'var(--color-text)',
  minHeight: 44,
};
