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
import { opsAuth, type Operator } from '@/lib/ops-session';

const MESSAGES: Record<'bad_credentials' | 'not_ops' | 'transport_failed', string> = {
  bad_credentials: 'البريد أو كلمة المرور غير صحيحة.',
  // Deliberately not "you are not ops". The person may be a legitimate
  // technician or customer who typed the wrong URL; telling them their account
  // lacks a role they have never heard of is confusing, and confirming that
  // the credentials WERE right hands a prober information.
  not_ops: 'هذا الحساب لا يملك صلاحية الدخول إلى لوحة التشغيل.',
  transport_failed: 'تعذّر الاتصال. حاول مرة أخرى.',
};

export function SignIn({ onSignedIn }: { readonly onSignedIn: (operator: Operator) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await opsAuth.signIn(email, password);
    setBusy(false);

    if (result.ok) {
      onSignedIn(result.operator);
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

        {error !== null ? (
          <p style={{ margin: 0, color: 'var(--color-emergency-fg)', fontSize: 'var(--text-sm)' }}>
            {error}
          </p>
        ) : null}

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
      </form>
    </main>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: 'var(--space-sm) var(--space-md)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-background)',
  color: 'var(--color-text)',
  minHeight: 44,
};
