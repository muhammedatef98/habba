/**
 * Sign-in for the ops console.
 *
 * ⚠️ This gate is UX, not security. `is_ops()` inside the database is the
 * boundary (0013): someone who skips this screen entirely reaches an API that
 * returns them nothing and accepts nothing. What the gate prevents is an
 * operator being shown a queue of controls that will fail when used, and a
 * signed-in technician landing on a console they have no business seeing.
 */

'use client';

import { useState } from 'react';
import { opsAuth, recoveryLinkFailed, type OpsState } from '@/lib/ops-session';

const MESSAGES: Record<'bad_credentials' | 'not_ops' | 'transport_failed', string> = {
  bad_credentials: 'البريد أو كلمة المرور غير صحيحة.',
  // Deliberately not "you are not ops". The person may be a legitimate
  // technician or customer who typed the wrong URL; telling them their account
  // lacks a role they have never heard of is confusing, and confirming that
  // the credentials WERE right hands a prober information.
  not_ops: 'هذا الحساب لا يملك صلاحية الدخول إلى لوحة التشغيل.',
  transport_failed: 'تعذّر الاتصال. حاول مرة أخرى.',
};

export function SignIn({
  onProgress,
  notice,
}: {
  readonly onProgress: (state: OpsState) => void;
  /** Said above the form, e.g. after a new password was set. */
  readonly notice?: string | undefined;
}) {
  const [mode, setMode] = useState<'sign_in' | 'forgot' | 'sent'>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    recoveryLinkFailed
      ? 'انتهت صلاحية رابط تعيين كلمة المرور أو استُخدم من قبل. اطلب رابطاً جديداً.'
      : null,
  );

  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await opsAuth.requestPasswordReset(email);
    setBusy(false);
    if (result.ok) {
      setMode('sent');
      return;
    }
    setError(
      result.reason === 'rate_limited'
        ? 'طلبت روابط كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.'
        : MESSAGES.transport_failed,
    );
  };

  if (mode !== 'sign_in') {
    return (
      <main style={pageStyle}>
        <form onSubmit={requestReset} style={cardStyle}>
          <div>
            <h1 style={titleStyle}>نسيت كلمة المرور</h1>
            <p style={subtitleStyle}>
              {mode === 'sent'
                ? 'إذا كان هذا البريد مسجّلاً لدينا، ستصلك خلال دقائق رسالة فيها رابط لتعيين كلمة مرور جديدة. افتح الرابط في هذا المتصفح. لم تصلك؟ تحقّق من مجلد الرسائل غير المرغوب فيها.'
                : 'أدخل بريدك الإلكتروني وسنرسل لك رابطاً لتعيين كلمة مرور جديدة. سيُطلب منك رمز تطبيق المصادقة أيضاً.'}
            </p>
          </div>

          {mode === 'forgot' ? (
            <>
              <label style={{ display: 'grid', gap: 'var(--space-xs)' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  البريد الإلكتروني
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                  dir="ltr"
                  style={fieldStyle}
                />
              </label>

              {error !== null ? <p style={errorStyle}>{error}</p> : null}

              <button
                type="submit"
                disabled={busy}
                style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}
              >
                {busy ? 'جارٍ الإرسال…' : 'أرسل الرابط'}
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setMode('sign_in');
              setError(null);
            }}
            style={linkButtonStyle}
          >
            العودة لتسجيل الدخول
          </button>
        </form>
      </main>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await opsAuth.signIn(email, password);
    setBusy(false);

    if (result.ok) {
      // Never straight to the console: the next step is always the second
      // factor, because the server will not count this session until then.
      onProgress(result.state);
      return;
    }
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
          maxWidth: 380,
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
            لوحة التشغيل
          </h1>
          <p
            style={{
              margin: 'var(--space-xs) 0 0',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            للموظّفين المخوّلين فقط.
          </p>
        </div>

        <label style={{ display: 'grid', gap: 'var(--space-xs)' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>البريد الإلكتروني</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
            dir="ltr"
            style={fieldStyle}
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--space-xs)' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>كلمة المرور</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            dir="ltr"
            style={fieldStyle}
          />
        </label>

        {notice !== undefined && error === null ? (
          <p className="notice" data-tone="good" style={{ margin: 0 }}>
            {notice}
          </p>
        ) : null}

        {error !== null ? <p style={errorStyle}>{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          style={{
            minHeight: 48,
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-text)',
            fontWeight: 600,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode('forgot');
            setError(null);
          }}
          style={linkButtonStyle}
        >
          نسيت كلمة المرور؟
        </button>
      </form>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 'var(--space-lg)',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  display: 'grid',
  gap: 'var(--space-base)',
  padding: 'var(--space-xl)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-surface)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--text-xl)',
  lineHeight: 'var(--leading-xl)',
  fontWeight: 600,
};

const subtitleStyle: React.CSSProperties = {
  margin: 'var(--space-xs) 0 0',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--text-sm)',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-emergency-fg)',
  fontSize: 'var(--text-sm)',
};

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 48,
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--color-primary)',
  color: 'var(--color-primary-text)',
  fontWeight: 600,
};

const linkButtonStyle: React.CSSProperties = {
  justifySelf: 'center',
  minHeight: 44,
  padding: '0 var(--space-sm)',
  border: 'none',
  background: 'none',
  color: 'var(--color-primary)',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  cursor: 'pointer',
};

const fieldStyle: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-md)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-background)',
  color: 'var(--color-text)',
  minHeight: 44,
};
