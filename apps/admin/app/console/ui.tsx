/**
 * The console's building blocks.
 *
 * Small and plain on purpose: a table, a card, a badge, a button, a field,
 * and the one pattern everything that changes something goes through — an
 * action that asks for its reason first (ActionButton). The server refuses an
 * action without a reason (0070); asking here means the operator is told the
 * rule rather than discovering it.
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, isLive } from '@/data/api';
import { explain } from '@/data/transport';
import type { Note } from '@/data/types';
import { dateTime } from '@/lib/format';
import type { Label, Tone } from './labels';

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
export interface Loaded<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

/**
 * Load on mount and whenever `key` changes; `reload` for after an action. The
 * previous data stays on screen while reloading, so acting on a row does not
 * blank the page under the operator.
 */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let live = true;
    setLoading(true);
    loader
      .current()
      .then((result) => {
        if (!live) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (live) setError(explain(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}

export function Loadable<T>({
  state,
  children,
}: {
  readonly state: Loaded<T>;
  readonly children: (data: T) => ReactNode;
}) {
  if (state.data !== null) return <>{children(state.data)}</>;
  if (state.error !== null) {
    return (
      <div className="notice" data-tone="bad">
        {state.error}{' '}
        <button className="link" onClick={state.reload}>
          إعادة المحاولة
        </button>
      </div>
    );
  }
  return <p className="muted">جارٍ التحميل…</p>;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <ToastContext.Provider value={setMessage}>
      {children}
      {message !== null ? (
        <div className="toast" role="status">
          {message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function PageHead({
  title,
  description,
  actions,
  back,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly back?: { readonly label: string | undefined; readonly href: string };
}) {
  return (
    <>
      {back !== undefined ? (
        <a className="back-link" href={back.href}>
          → {back.label}
        </a>
      ) : null}
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {description !== undefined ? <p>{description}</p> : null}
        </div>
        {actions !== undefined ? <div className="actions">{actions}</div> : null}
      </header>
      {!isLive ? (
        <p className="notice" data-tone="warn">
          بيانات تجريبية — لم تُربط اللوحة بمشروع بعد. لا يُحفظ شيء مما تفعله هنا.
        </p>
      ) : null}
    </>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  readonly title?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section className="card">
      {title !== undefined || actions !== undefined ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            flexWrap: 'wrap',
            marginBottom: 'var(--space-md)',
          }}
        >
          {title !== undefined ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions !== undefined ? <div className="actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone,
  href,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: 'alert' | undefined;
  readonly href?: string | undefined;
}) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </>
  );
  if (href !== undefined) {
    return (
      <a
        className="stat"
        data-tone={tone}
        data-clickable="true"
        href={href}
        style={{ color: 'inherit', textDecoration: 'none' }}
      >
        {body}
      </a>
    );
  }
  return (
    <div className="stat" data-tone={tone}>
      {body}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  readonly tone?: Tone | undefined;
  readonly children: ReactNode;
}) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function LabelBadge({ value }: { readonly value: Label }) {
  return <Badge tone={value.tone}>{value.text}</Badge>;
}

export function KeyValue({ items }: { readonly items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="kv">
      {items.map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt>{key}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  readonly tabs: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={tab.value === value}
          className="tab"
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
export interface Column<T> {
  readonly label: string;
  readonly render: (row: T) => ReactNode;
  readonly numeric?: boolean | undefined;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly onRowClick?: (row: T) => void | undefined;
  readonly empty?: ReactNode | undefined;
}) {
  if (rows.length === 0) return <Empty>{empty ?? 'لا شيء هنا.'}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              data-clickable={onRowClick !== undefined}
              onClick={onRowClick !== undefined ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.label} className={column.numeric === true ? 'numeric' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  offset,
  pageSize,
  total,
  onChange,
}: {
  readonly offset: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onChange: (offset: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="actions" style={{ marginTop: 'var(--space-md)', alignItems: 'center' }}>
      <Button
        size="small"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - pageSize))}
      >
        السابق
      </Button>
      <span className="muted numeric">
        {offset + 1}–{Math.min(offset + pageSize, total)} من {total}
      </span>
      <Button
        size="small"
        disabled={offset + pageSize >= total}
        onClick={() => onChange(offset + pageSize)}
      >
        التالي
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
export function Button({
  tone = 'neutral',
  size,
  busy = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
}: {
  readonly tone?: 'primary' | 'neutral' | 'danger' | undefined;
  readonly size?: 'small' | undefined;
  readonly busy?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly type?: 'button' | 'submit' | undefined;
  readonly onClick?: () => void | undefined;
  readonly children: ReactNode;
}) {
  return (
    <button
      className="btn"
      data-tone={tone}
      data-size={size}
      type={type}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? 'جارٍ…' : children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: ReactNode | undefined;
  readonly children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint !== undefined ? <small>{hint}</small> : null}
    </label>
  );
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * A button that opens a dialog asking for the reason, and any other values
 * the action needs, then runs it. Errors stay in the dialog, in Arabic, and
 * the operator can correct and retry without losing what they typed.
 */
export function ActionButton({
  label,
  title,
  description,
  tone = 'neutral',
  size,
  reason = 'required',
  reasonLabel = 'السبب',
  reasonHint = 'يُسجَّل باسمك مع الإجراء.',
  confirmLabel,
  fields,
  onConfirm,
  onDone,
  success,
}: {
  readonly label: string;
  readonly title?: string | undefined;
  readonly description?: ReactNode | undefined;
  readonly tone?: 'primary' | 'neutral' | 'danger' | undefined;
  readonly size?: 'small' | undefined;
  readonly reason?: 'required' | 'optional' | 'none' | undefined;
  readonly reasonLabel?: string | undefined;
  readonly reasonHint?: string | undefined;
  readonly confirmLabel?: string | undefined;
  readonly fields?: ReactNode | undefined;
  readonly onConfirm: (reason: string) => Promise<unknown>;
  readonly onDone?: () => void | undefined;
  readonly success?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const close = useCallback(() => {
    if (!busy) {
      setOpen(false);
      setError(null);
    }
  }, [busy]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason === 'required' && text.trim().length < 3) {
      setError('اكتب السبب — يُسجَّل مع الإجراء.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      setOpen(false);
      setText('');
      toast(success ?? 'تم.');
      onDone?.();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button tone={tone} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <Dialog title={title ?? label} onClose={close}>
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-base)' }}>
            {description !== undefined ? <div className="muted">{description}</div> : null}
            {fields}
            {reason !== 'none' ? (
              <Field label={reasonLabel} hint={reasonHint}>
                <textarea
                  className="input"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={3}
                  autoFocus
                />
              </Field>
            ) : null}
            {error !== null ? (
              <p className="notice" data-tone="bad" style={{ margin: 0 }}>
                {error}
              </p>
            ) : null}
            <div className="actions">
              <Button type="submit" tone={tone === 'danger' ? 'danger' : 'primary'} busy={busy}>
                {confirmLabel ?? label}
              </Button>
              <Button onClick={close} disabled={busy}>
                تراجع
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Internal notes, shared by every file
// ---------------------------------------------------------------------------
export function NotesCard({
  table,
  id,
  notes,
  onChanged,
}: {
  readonly table: 'orders' | 'profiles' | 'providers' | 'vehicles';
  readonly id: string;
  readonly notes: readonly Note[];
  readonly onChanged: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (body.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await api.addNote(table, id, body.trim());
      setBody('');
      onChanged();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="ملاحظات داخلية">
      <p className="subtle" style={{ marginTop: 0 }}>
        للفريق فقط — لا يراها العميل ولا مقدّم الخدمة.
      </p>
      <form onSubmit={add} style={{ display: 'grid', gap: 'var(--space-sm)' }}>
        <textarea
          className="input"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="مثال: العميل اتصل وأكّد العنوان"
          rows={2}
        />
        {error !== null ? (
          <p className="notice" data-tone="bad">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" size="small" busy={busy} disabled={body.trim() === ''}>
            إضافة ملاحظة
          </Button>
        </div>
      </form>
      {notes.length > 0 ? (
        <ul className="list" style={{ marginTop: 'var(--space-base)' }}>
          {notes.map((note) => (
            <li key={note.id} className="timeline-item">
              <div>{note.body}</div>
              <div className="subtle">
                {note.author_name ?? '—'} · {dateTime(note.created_at)}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
