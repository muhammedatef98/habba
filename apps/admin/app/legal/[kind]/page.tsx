/**
 * The terms, the privacy policy and the provider terms, public on the web
 * (0083): the address the App Store and Google Play listings link to, and
 * the one to put in `terms_url` / `privacy_url`.
 *
 *   /legal/terms   /legal/privacy   /legal/provider_terms   (?lang=en)
 *
 * Rendered on the server from the version in force, with the same filling and
 * parsing the app uses (@habba/core), and read with the publishable key only:
 * a published document is public by RLS, so nothing here needs more. No
 * console code runs on this page — it is a separate route with its own
 * server component, and it never loads the console bundle.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  fillLegalTemplate,
  LEGAL_DOCUMENT_KINDS,
  legalTemplateValues,
  parseLegalDocument,
  type LegalDocumentKind,
} from '@habba/core/legal';

// A new version shows within five minutes of being published.
export const revalidate = 300;

const TITLES: Readonly<Record<LegalDocumentKind, { ar: string; en: string }>> = {
  terms: { ar: 'الشروط والأحكام', en: 'Terms of use' },
  privacy: { ar: 'سياسة الخصوصية', en: 'Privacy policy' },
  provider_terms: { ar: 'شروط مقدّمي الخدمة', en: 'Provider terms' },
};

interface Params {
  readonly params: Promise<{ kind: string }>;
  readonly searchParams: Promise<{ lang?: string }>;
}

function kindOf(value: string): LegalDocumentKind | null {
  return LEGAL_DOCUMENT_KINDS.find((kind) => kind === value) ?? null;
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const kind = kindOf((await params).kind);
  const english = (await searchParams).lang === 'en';
  if (kind === null) return {};
  return { title: `${english ? 'Habba' : 'هبّة'} — ${TITLES[kind][english ? 'en' : 'ar']}` };
}

interface DocumentRow {
  readonly version: number;
  readonly published_at: string;
  readonly body_ar: string;
  readonly body_en: string;
}

async function load(kind: LegalDocumentKind): Promise<{
  document: DocumentRow;
  settings: Record<string, unknown>;
} | null> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';
  if (url === '' || key === '') return null;

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const query = new URLSearchParams({
    select: 'version,published_at,body_ar,body_en',
    kind: `eq.${kind}`,
    published_at: `lte.${new Date().toISOString()}`,
    order: 'version.desc',
    limit: '1',
  });
  const [documents, settings] = await Promise.all([
    fetch(`${url}/rest/v1/legal_documents?${query.toString()}`, { headers }),
    fetch(`${url}/rest/v1/rpc/get_public_settings`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
    }),
  ]);
  if (!documents.ok) return null;
  const [document] = (await documents.json()) as DocumentRow[];
  if (document === undefined) return null;
  return {
    document,
    settings: settings.ok ? ((await settings.json()) as Record<string, unknown>) : {},
  };
}

export default async function LegalPage({ params, searchParams }: Params) {
  const kind = kindOf((await params).kind);
  if (kind === null) notFound();
  const locale = (await searchParams).lang === 'en' ? 'en' : 'ar';
  const loaded = await load(kind);

  const other = locale === 'ar' ? '?lang=en' : '?lang=ar';

  return (
    <main
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: 'var(--space-xl) var(--space-base) var(--space-2xl)',
        display: 'grid',
        gap: 'var(--space-md)',
        lineHeight: 1.8,
      }}
    >
      <nav style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)' }}>
        <strong>{locale === 'ar' ? 'هبّة' : 'Habba'}</strong>
        <a className="link" href={other}>
          {locale === 'ar' ? 'English' : 'العربية'}
        </a>
      </nav>
      {loaded === null ? (
        <p className="notice" data-tone="warn">
          {locale === 'ar'
            ? 'تعذّر تحميل المستند الآن. حاول لاحقاً.'
            : 'The document could not be loaded right now. Please try again later.'}
        </p>
      ) : (
        parseLegalDocument(
          fillLegalTemplate(
            locale === 'ar' ? loaded.document.body_ar : loaded.document.body_en,
            legalTemplateValues(
              loaded.settings,
              {
                version: loaded.document.version,
                publishedAt: loaded.document.published_at,
              },
              locale,
            ),
          ),
        ).map((block, index) => {
          switch (block.type) {
            case 'title':
              return <h1 key={index}>{block.text}</h1>;
            case 'heading':
              return (
                <h2 key={index} style={{ marginBottom: 0 }}>
                  {block.text}
                </h2>
              );
            case 'note':
              return (
                <p key={index} className="subtle">
                  {block.text}
                </p>
              );
            case 'paragraph':
            case 'bullet': {
              const runs = block.runs.map((run, runIndex) =>
                run.bold ? <strong key={runIndex}>{run.text}</strong> : run.text,
              );
              return block.type === 'paragraph' ? (
                <p key={index} style={{ margin: 0 }}>
                  {runs}
                </p>
              ) : (
                <p key={index} style={{ margin: 0, paddingInlineStart: 'var(--space-lg)' }}>
                  • {runs}
                </p>
              );
            }
          }
        })
      )}
    </main>
  );
}
