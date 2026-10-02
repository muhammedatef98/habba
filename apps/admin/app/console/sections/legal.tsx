/**
 * The terms, the privacy policy and the provider terms (0083).
 *
 * Every version stays readable here, with how many people accepted it: that
 * count is the evidence behind each version. A version is never edited; a
 * change is a new version, which the database numbers and the audit log
 * records. A change that needs everyone's agreement again asks every user at
 * their next launch; a correction (a typo) can be published without asking.
 * A version can be dated ahead, so a change can be announced before it applies.
 */

'use client';

import { useState } from 'react';
import { parseLegalDocument } from '@habba/core/legal';
import { api } from '@/data/api';
import { explain } from '@/data/transport';
import type { LegalDocumentRow } from '@/data/types';
import { dateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Loadable,
  PageHead,
  useLoad,
  useToast,
} from '../ui';

const KIND_LABEL: Readonly<Record<LegalDocumentRow['kind'], string>> = {
  terms: 'الشروط والأحكام',
  privacy: 'سياسة الخصوصية',
  provider_terms: 'شروط مقدّمي الخدمة',
};

const KINDS = Object.keys(KIND_LABEL) as LegalDocumentRow['kind'][];

export function LegalSection() {
  const state = useLoad(() => api.legalDocuments(), 'legal-documents');
  const [reading, setReading] = useState<LegalDocumentRow | null>(null);
  const [drafting, setDrafting] = useState<LegalDocumentRow | null>(null);

  return (
    <>
      <PageHead
        title="الشروط والسياسات"
        description="كل إصدار محفوظ كما نُشر ولا يُعدَّل، ومعه عدد من وافق عليه. التعديل يكون بنشر إصدار جديد. تُملأ بيانات الشركة في النصوص من الإعدادات ← «الشروط والخصوصية»."
      />
      <p className="notice" data-tone="warn">
        راجع أي تعديل مع مستشار قانوني مرخّص في المملكة قبل نشره. النص العربي هو المعتمد.
      </p>
      <Loadable state={state}>
        {(rows) => (
          <div className="grid">
            {KINDS.map((kind) => {
              const versions = rows.filter((row) => row.kind === kind);
              const current = versions.find((row) => row.is_current) ?? null;
              return (
                <Card
                  key={kind}
                  title={KIND_LABEL[kind]}
                  actions={
                    current !== null ? (
                      <Button tone="primary" size="small" onClick={() => setDrafting(current)}>
                        نشر إصدار جديد
                      </Button>
                    ) : null
                  }
                >
                  <DataTable<LegalDocumentRow>
                    rows={versions}
                    rowKey={(row) => row.id}
                    empty="لا إصدارات."
                    columns={[
                      {
                        label: 'الإصدار',
                        render: (row) => (
                          <span className="actions" style={{ alignItems: 'center' }}>
                            <span className="numeric">{row.version}</span>
                            {row.is_current ? <Badge tone="good">الساري</Badge> : null}
                            {new Date(row.published_at).getTime() > Date.now() ? (
                              <Badge tone="info">مجدول</Badge>
                            ) : null}
                          </span>
                        ),
                      },
                      {
                        label: 'ما الذي تغيّر',
                        render: (row) => (
                          <>
                            {row.summary_ar ?? <span className="muted">—</span>}
                            {!row.requires_acceptance ? (
                              <div>
                                <span className="subtle">لم يُطلب قبوله من جديد</span>
                              </div>
                            ) : null}
                          </>
                        ),
                      },
                      {
                        label: 'يسري من',
                        render: (row) => (
                          <span className="numeric">{dateTime(row.published_at)}</span>
                        ),
                      },
                      {
                        label: 'وافق عليه',
                        numeric: true,
                        render: (row) => row.acceptances.toLocaleString('en'),
                      },
                      { label: 'نشره', render: (row) => row.created_by_name ?? 'الإصدار الأول' },
                      {
                        label: '',
                        render: (row) => (
                          <button className="link" onClick={() => setReading(row)}>
                            عرض النص
                          </button>
                        ),
                      },
                    ]}
                  />
                </Card>
              );
            })}
          </div>
        )}
      </Loadable>

      {reading !== null ? <ReadDialog document={reading} onClose={() => setReading(null)} /> : null}
      {drafting !== null ? (
        <PublishDialog
          current={drafting}
          onClose={() => setDrafting(null)}
          onPublished={() => {
            setDrafting(null);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ReadDialog({
  document,
  onClose,
}: {
  readonly document: LegalDocumentRow;
  readonly onClose: () => void;
}) {
  const text = useLoad(() => api.legalDocumentText(document.id), `legal-text-${document.id}`);
  const [english, setEnglish] = useState(false);

  return (
    <Dialog title={`${KIND_LABEL[document.kind]} — الإصدار ${document.version}`} onClose={onClose}>
      <div className="actions" style={{ marginBottom: 'var(--space-md)' }}>
        <Button
          size="small"
          tone={english ? 'neutral' : 'primary'}
          onClick={() => setEnglish(false)}
        >
          العربية
        </Button>
        <Button
          size="small"
          tone={english ? 'primary' : 'neutral'}
          onClick={() => setEnglish(true)}
        >
          English
        </Button>
      </div>
      <Loadable state={text}>
        {(body) => (
          <div
            dir={english ? 'ltr' : 'rtl'}
            style={{
              maxHeight: '60vh',
              overflowY: 'auto',
              display: 'grid',
              gap: 'var(--space-sm)',
            }}
          >
            <LegalBlocks markdown={english ? body.bodyEn : body.bodyAr} />
          </div>
        )}
      </Loadable>
    </Dialog>
  );
}

/** The document as the app shows it; placeholders stay visible as {{…}} here. */
function LegalBlocks({ markdown }: { readonly markdown: string }) {
  return (
    <>
      {parseLegalDocument(markdown).map((block, index) => {
        switch (block.type) {
          case 'title':
            return <h2 key={index}>{block.text}</h2>;
          case 'heading':
            return <h3 key={index}>{block.text}</h3>;
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
              <p key={index} style={{ margin: 0, paddingInlineStart: 'var(--space-md)' }}>
                • {runs}
              </p>
            );
          }
        }
      })}
    </>
  );
}

function PublishDialog({
  current,
  onClose,
  onPublished,
}: {
  readonly current: LegalDocumentRow;
  readonly onClose: () => void;
  readonly onPublished: () => void;
}) {
  const text = useLoad(() => api.legalDocumentText(current.id), `legal-draft-${current.id}`);

  return (
    <Dialog title={`إصدار جديد من ${KIND_LABEL[current.kind]}`} onClose={onClose}>
      <Loadable state={text}>
        {(body) => (
          <PublishForm
            current={current}
            initialAr={body.bodyAr}
            initialEn={body.bodyEn}
            onPublished={onPublished}
          />
        )}
      </Loadable>
    </Dialog>
  );
}

function PublishForm({
  current,
  initialAr,
  initialEn,
  onPublished,
}: {
  readonly current: LegalDocumentRow;
  readonly initialAr: string;
  readonly initialEn: string;
  readonly onPublished: () => void;
}) {
  const toast = useToast();
  const [bodyAr, setBodyAr] = useState(initialAr);
  const [bodyEn, setBodyEn] = useState(initialEn);
  const [summary, setSummary] = useState('');
  const [requiresAcceptance, setRequiresAcceptance] = useState(true);
  const [effectiveAt, setEffectiveAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unchanged = bodyAr === initialAr && bodyEn === initialEn;

  const publish = async () => {
    if (summary.trim() === '') {
      setError('اكتب ملخّصاً لما تغيّر — يراه المستخدم عند طلب موافقته.');
      return;
    }
    const when = effectiveAt === '' ? null : new Date(effectiveAt).toISOString();
    const message = requiresAcceptance
      ? 'سيُطلب من كل مستخدم الموافقة على هذا الإصدار عند فتح التطبيق. النشر لا يُتراجع عنه. متابعة؟'
      : 'يُنشر الإصدار دون طلب موافقة جديدة. النشر لا يُتراجع عنه. متابعة؟';
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    try {
      await api.publishLegalDocument({
        kind: current.kind,
        bodyAr,
        bodyEn,
        summaryAr: summary,
        requiresAcceptance,
        publishedAt: when,
      });
      toast('نُشر الإصدار الجديد.');
      onPublished();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
      <Field
        label="النص العربي (المعتمد)"
        hint="عناوين بـ ## ، وبنود بـ - ، وعريض بـ **…**. تُملأ {{company}} و{{cr}} و{{address}} و{{email}} و{{phone}} و{{dispute_window_days}} و{{auto_complete_hours}} و{{version}} و{{effective_date}} تلقائياً."
      >
        <textarea
          className="input"
          dir="rtl"
          rows={14}
          value={bodyAr}
          onChange={(event) => setBodyAr(event.target.value)}
        />
      </Field>
      <Field label="النص الإنجليزي (ترجمة)">
        <textarea
          className="input"
          dir="ltr"
          rows={10}
          value={bodyEn}
          onChange={(event) => setBodyEn(event.target.value)}
        />
      </Field>
      <Field
        label="ملخّص ما تغيّر"
        hint="يظهر للمستخدم في شاشة الموافقة، مثل: «تعديل سياسة الإلغاء»."
      >
        <input
          className="input"
          maxLength={500}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </Field>
      <Field
        label="يسري من"
        hint="اتركه فارغاً ليسري فوراً، أو حدّد تاريخاً لاحقاً لإعلان التعديل قبل سريانه."
      >
        <input
          className="input numeric"
          type="datetime-local"
          value={effectiveAt}
          onChange={(event) => setEffectiveAt(event.target.value)}
          style={{ maxWidth: 260 }}
        />
      </Field>
      <label className="actions" style={{ alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={requiresAcceptance}
          onChange={(event) => setRequiresAcceptance(event.target.checked)}
        />
        <span>
          اطلب موافقة المستخدمين من جديد
          <span className="subtle"> — ألغِ التحديد لتصحيح لا يغيّر المعنى فقط</span>
        </span>
      </label>
      {error !== null ? (
        <p className="notice" data-tone="bad" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="actions">
        <Button tone="primary" busy={busy} disabled={unchanged} onClick={() => void publish()}>
          {`نشر الإصدار ${current.version + 1}`}
        </Button>
        {unchanged ? <span className="subtle">عدّل النص أولاً.</span> : null}
      </div>
    </div>
  );
}
