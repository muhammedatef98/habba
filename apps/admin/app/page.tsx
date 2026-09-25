/**
 * The ops console's one page: the sign-in gate, then the console.
 *
 * ⚠️ The gate is UX, not security. `is_ops()` in the database is the boundary
 * (0068): an operator role, a second factor, within eight hours. Someone who
 * skips these screens reaches functions that refuse them (0070).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { opsAuth, type OpsState } from '@/lib/ops-session';
import { SignIn } from './sign-in';
import { TwoFactor } from './two-factor';
import { Shell } from './console/shell';

export default function AdminEntry() {
  const [state, setState] = useState<OpsState | null>(null);

  // Re-checked on load rather than trusted from storage: the role and the
  // session's standing are read from the server each time (ops_whoami, 0068),
  // so revoked access or a lapsed eight hours is noticed on the next visit.
  useEffect(() => {
    void opsAuth.current().then(setState);
  }, []);

  const recheck = useCallback(() => void opsAuth.current().then(setState), []);

  // §5.1.6: eight hours from the second factor. The server enforces it on
  // every request regardless; this stops showing controls that would now fail,
  // and sends the operator to verify again.
  useEffect(() => {
    if (state?.stage !== 'ready') return;
    const remaining = state.operator.expiresAt.getTime() - Date.now();
    const timer = setTimeout(recheck, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [state, recheck]);

  if (state === null) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p className="muted">جارٍ التحقّق…</p>
      </main>
    );
  }

  if (state.stage === 'signed_out') return <SignIn onProgress={setState} />;

  if (state.stage === 'enrol' || state.stage === 'verify') {
    return (
      <TwoFactor
        state={state}
        onProgress={setState}
        onCancel={() => void opsAuth.signOut().then(() => setState({ stage: 'signed_out' }))}
      />
    );
  }

  return (
    <Shell
      operator={state.operator}
      onSignOut={() => void opsAuth.signOut().then(() => setState({ stage: 'signed_out' }))}
    />
  );
}
