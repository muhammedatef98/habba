/**
 * How the console talks to the database.
 *
 * Deliberately thin: named server functions (`rpc`) for everything that
 * decides anything, and plain table access only for the catalogue and the
 * settings, which RLS already opens to operators and nobody else. Every rule —
 * who may, with what reason, within what bounds — is in SQL (0069, 0070), so
 * nothing here needs to be trusted.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ListOptions {
  readonly columns?: string;
  readonly order?: string;
  readonly ascending?: boolean;
  readonly eq?: Readonly<Record<string, string | number | boolean>>;
  readonly in?: Readonly<Record<string, readonly (string | number)[]>>;
  readonly limit?: number;
}

export type Row = Record<string, unknown>;

export interface Transport {
  rpc<T>(fn: string, args?: Readonly<Record<string, unknown>>): Promise<T>;
  list<T extends Row>(table: string, options?: ListOptions): Promise<T[]>;
  insert(table: string, row: Row): Promise<void>;
  update(table: string, match: Row, patch: Row): Promise<void>;
  remove(table: string, match: Row): Promise<void>;
}

/** A refusal or failure from the server, carrying what the screen needs to explain it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly hint: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface PostgrestFailure {
  readonly message: string;
  readonly code?: string;
  readonly hint?: string | null;
}

function fail(error: PostgrestFailure): never {
  throw new ApiError(error.message, error.code ?? null, error.hint ?? null);
}

export class SupabaseTransport implements Transport {
  constructor(private readonly client: SupabaseClient) {}

  async rpc<T>(fn: string, args?: Readonly<Record<string, unknown>>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args ?? {});
    if (error !== null) fail(error);
    return data as T;
  }

  async list<T extends Row>(table: string, options: ListOptions = {}): Promise<T[]> {
    let query = this.client.from(table).select(options.columns ?? '*');
    for (const [column, value] of Object.entries(options.eq ?? {})) {
      query = query.eq(column, value);
    }
    for (const [column, values] of Object.entries(options.in ?? {})) {
      query = query.in(column, [...values]);
    }
    if (options.order !== undefined) {
      query = query.order(options.order, { ascending: options.ascending ?? true });
    }
    if (options.limit !== undefined) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error !== null) fail(error);
    return (data ?? []) as unknown as T[];
  }

  async insert(table: string, row: Row): Promise<void> {
    const { error } = await this.client.from(table).insert(row);
    if (error !== null) fail(error);
  }

  async update(table: string, match: Row, patch: Row): Promise<void> {
    const { error } = await this.client.from(table).update(patch).match(match);
    if (error !== null) fail(error);
  }

  async remove(table: string, match: Row): Promise<void> {
    const { error } = await this.client.from(table).delete().match(match);
    if (error !== null) fail(error);
  }
}

/**
 * The operator-facing sentence for a refusal. The server's messages are
 * written for developers and logs; the operator gets Arabic, and the server's
 * own words underneath for anything not listed here.
 */
export function explain(error: unknown): string {
  if (!(error instanceof Error)) return 'حدث خطأ غير متوقع.';
  const message = error.message;
  const code = error instanceof ApiError ? error.code : null;

  const known: readonly (readonly [RegExp, string])[] = [
    [/reason is required/i, 'اكتب السبب — يُسجَّل مع الإجراء.'],
    [/Only a super admin/i, 'هذا الإجراء للمشرف العام فقط.'],
    [/cannot suspend or reinstate yourself/i, 'لا يمكنك إيقاف حسابك أو إعادته بنفسك.'],
    [/own super admin role/i, 'لا يمكنك إزالة صلاحية المشرف العام عن نفسك.'],
    [/not funded/i, 'الطلب غير مموَّل — لم يُعتمد الدفع بعد.'],
    [/does not offer this service/i, 'مقدّم الخدمة لا يقدّم هذه الخدمة.'],
    [/Only an approved provider/i, 'يمكن الإسناد إلى مقدّم خدمة معتمد فقط.'],
    [/account is suspended/i, 'الحساب موقوف.'],
    [/cannot be cancelled/i, 'لا يُلغى طلب منتهٍ — يُعالَج عبر شكوى.'],
    [/partial refund/i, 'الاسترداد الجزئي أكبر من صفر وأقل من المبلغ المدفوع.'],
    [/Nothing was captured/i, 'لم يُحصَّل أي مبلغ على هذا الطلب ليُسترد.'],
    [/reference/i, 'سجّل الرقم المرجعي من مزوّد الدفع أو البنك.'],
    [/must be at least|must be at most/i, 'القيمة خارج الحدود المسموحة.'],
    [/must be a/i, 'نوع القيمة غير صحيح.'],
    [/in progress or in dispute/i, 'لديه طلب جارٍ أو شكوى مفتوحة — أنهِها أولاً.'],
    [/payout still to be paid/i, 'لديه مستحقات لم تُدفع بعد.'],
    [/Remove the staff role first/i, 'أزل صلاحية الموظف أولاً.'],
    [/not in dispute/i, 'هذا الطلب ليس في شكوى.'],
  ];

  for (const [pattern, text] of known) {
    if (pattern.test(message)) return text;
  }
  if (code === '42501') {
    return 'لا تملك صلاحية هذا الإجراء، أو انتهت جلستك. سجّل الدخول من جديد إن تكرّر.';
  }
  return `تعذّر التنفيذ: ${message}`;
}
