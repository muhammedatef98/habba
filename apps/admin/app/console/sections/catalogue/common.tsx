/**
 * What the catalogue's editors share: loading the options other tables offer,
 * reading coordinates an operator pastes, the price a customer pays, and the
 * toolbar every list opens with.
 */

'use client';

import { api } from '@/data/api';
import type { Row } from '@/data/transport';
import { useLoad } from '../../ui';

export type Option = { readonly value: string; readonly text: string };
export type Refs = Readonly<Record<string, readonly Option[]>>;

export interface RefSpec {
  readonly table: string;
  readonly label: string;
  /** The column the foreign key points at — `id` unless the key is a natural one. */
  readonly value?: string;
}

export function useRefs(specs: readonly RefSpec[]): Refs {
  const key = specs.map((spec) => `${spec.table}:${spec.label}:${spec.value ?? 'id'}`).join(',');
  const state = useLoad(async () => {
    const entries = await Promise.all(
      specs.map(async (spec) => {
        const valueKey = spec.value ?? 'id';
        const rows = await api.table<Row>(spec.table, { columns: `${valueKey}, ${spec.label}` });
        return [
          spec.table,
          rows.map((row) => ({ value: String(row[valueKey]), text: String(row[spec.label]) })),
        ] as const;
      }),
    );
    return Object.fromEntries(entries) as Refs;
  }, `refs:${key}`);
  return state.data ?? {};
}

/**
 * A coordinate from whatever an operator pastes: «26.4207, 50.1033», a Google
 * Maps link (…/@26.4207,50.1033,15z or …?q=26.4207,50.1033), or an Apple Maps
 * link (…&ll=26.4207,50.1033). Latitude first, as every map shows it.
 */
export function parseCoordinate(text: string): { lat: number; lon: number } | null {
  const trimmed = text.trim();
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match === null) continue;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  return null;
}

/** A stored point (GeoJSON from PostgREST, or EWKT) as «lat, lon», or ''. */
export function pointText(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'coordinates' in value) {
    const [lon, lat] = (value as { coordinates: readonly number[] }).coordinates;
    if (lat !== undefined && lon !== undefined) return `${lat}, ${lon}`;
  }
  if (typeof value === 'string') {
    const match = /POINT\((-?[\d.]+) (-?[\d.]+)\)/.exec(value);
    if (match !== null) return `${match[2]}, ${match[1]}`;
  }
  return '';
}

/** What the customer pays for a base price, VAT included, to the halala. */
export function withVat(base: number, vatRate: number): number {
  return Math.round(base * (1 + vatRate) * 100) / 100;
}

/** The VAT rate in force today (vat_rates), or 15% until it loads. */
export function useVatRate(): number {
  const state = useLoad(() => api.table<Row>('vat_rates', { order: 'valid_from' }), 'vat_rates');
  const today = new Date().toISOString().slice(0, 10);
  const current = (state.data ?? [])
    .filter(
      (row) =>
        String(row['valid_from']) <= today &&
        (row['valid_to'] === null || String(row['valid_to']) >= today),
    )
    .sort((a, b) => String(b['valid_from']).localeCompare(String(a['valid_from'])))[0];
  return current !== undefined ? Number(current['rate']) : 0.15;
}

/** Arabic and English, digits of both scripts, case folded: for list search. */
export function matches(needle: string, ...values: readonly unknown[]): boolean {
  const query = needle.trim().toLowerCase();
  if (query === '') return true;
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(query),
  );
}

export type ActiveFilter = 'all' | 'on' | 'off';

export function ListToolbar({
  query,
  onQuery,
  active,
  onActive,
  count,
  children,
}: {
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly active?: ActiveFilter | undefined;
  readonly onActive?: ((value: ActiveFilter) => void) | undefined;
  readonly count: number;
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="actions" style={{ alignItems: 'center', marginBottom: 'var(--space-md)' }}>
      <input
        className="input"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="ابحث بالاسم…"
        style={{ maxWidth: 260 }}
      />
      {active !== undefined && onActive !== undefined ? (
        <div className="chip-group" role="group" aria-label="الحالة">
          {(
            [
              ['all', 'الكل'],
              ['on', 'المفعّلة'],
              ['off', 'المعطّلة'],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={active === value}
              onClick={() => onActive(value)}
            >
              {text}
            </button>
          ))}
        </div>
      ) : null}
      {children}
      <span className="subtle" style={{ marginInlineStart: 'auto' }}>
        {count} سجل
      </span>
    </div>
  );
}

export function activeMatches(filter: ActiveFilter, value: unknown): boolean {
  if (filter === 'all') return true;
  return filter === 'on' ? value === true : value !== true;
}

/** Confirms closing a form with unsaved changes. */
export function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm('لديك تعديلات لم تُحفظ. إغلاق النموذج بدونها؟');
}

export function explainDelete(message: string): string | null {
  return /foreign key|violates|23503/i.test(message)
    ? 'لا يمكن الحذف لأن سجلات أخرى تعتمد عليه — عطّله بدلاً من ذلك.'
    : null;
}
