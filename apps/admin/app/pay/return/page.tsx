/**
 * /pay/return — Moyasar's `callback_url` after 3-D Secure.
 *
 * The in-app browser the payment opened in is watching for the app's own
 * link, and closes as soon as this page sends it there. Nothing is decided
 * here: the status in the address is only a hint for the screen. The hold is
 * recorded by the `payments` function after it has fetched the payment from
 * Moyasar with the secret key.
 *
 * Public, no session, no console code: a separate route, like /legal.
 */

import type { Metadata } from 'next';
import { appReturnUrl } from '../return-url';

export const metadata: Metadata = { title: 'هبّة — الدفع', robots: { index: false } };
export const dynamic = 'force-dynamic';

interface Params {
  readonly searchParams: Promise<{
    to?: string;
    id?: string;
    status?: string;
    message?: string;
  }>;
}

export default async function PaymentReturnPage({ searchParams }: Params) {
  const query = await searchParams;
  const target = appReturnUrl(query.to, query);
  const authorised = query.status === 'authorized';

  return (
    <main
      lang="ar"
      dir="rtl"
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: 'var(--space-2xl) var(--space-base)',
        display: 'grid',
        gap: 'var(--space-md)',
        textAlign: 'center',
      }}
    >
      {target !== null ? <meta httpEquiv="refresh" content={`0;url=${target}`} /> : null}
      <strong>هبّة</strong>
      <h1 style={{ fontSize: '1.25rem', margin: 0 }}>
        {authorised ? 'تم التحقق من البطاقة' : 'انتهت خطوة التحقق'}
      </h1>
      <p style={{ margin: 0 }}>
        {authorised
          ? 'المبلغ محجوز فقط، ولن يُخصم إلا بعد أن تؤكّد اكتمال العمل.'
          : 'ارجع إلى التطبيق لإكمال الطلب.'}
      </p>
      {target !== null ? (
        <a className="link" href={target}>
          العودة إلى التطبيق
        </a>
      ) : null}
    </main>
  );
}
