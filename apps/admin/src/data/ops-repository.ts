/**
 * The ops console's data layer.
 *
 * Supabase when the console has been pointed at a project, in-memory
 * otherwise — the same switch as the customer app, and for the same reason:
 * the whole screen can be built and reviewed before a project exists (ADR-0010).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AuditEntry,
  BoardOrder,
  OpsRepository,
  PayoutRow,
  PayoutStatus,
  ProviderReview,
  VerificationEvent,
  VerificationStatus,
} from './types';

interface PayoutDbRow {
  readonly id: string;
  readonly provider_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly gross_amount: number | string;
  readonly commission: number | string;
  readonly net_amount: number | string;
  readonly order_count: number;
  readonly status: PayoutStatus;
  readonly paid_at: string | null;
  readonly reference: string | null;
  readonly providers: { readonly business_name_ar: string } | null;
}

interface AuditDbRow {
  readonly id: number;
  readonly actor_id: string | null;
  readonly actor_role: string | null;
  readonly action: string;
  readonly target_table: string;
  readonly target_id: string | null;
  readonly changed_columns: readonly string[] | null;
  readonly at: string;
  readonly ip: string | null;
}

/**
 * Money as the database holds it, to two places, as a string.
 *
 * ⚠️ Never a float in arithmetic. `numeric(12,2)` arrives from PostgREST as a
 * string, and the one thing this console must not do is parse it, round it and
 * show somebody a figure that differs from what was transferred.
 */
function money(value: number | string): string {
  return typeof value === 'string' ? value : value.toFixed(2);
}

interface ProviderRow {
  readonly id: string;
  readonly business_name_ar: string;
  readonly provider_type: 'individual' | 'workshop';
  readonly verification_status: VerificationStatus;
  readonly nafath_verified_at: string | null;
  readonly created_at: string;
  readonly rating_avg: number;
  readonly rating_count: number;
  readonly cities: readonly { readonly name_ar: string }[] | null;
}

class SupabaseOpsRepository implements OpsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listBoard(): Promise<readonly BoardOrder[]> {
    const { data, error } = await this.client.rpc('ops_active_orders');
    if (error !== null) throw new Error(`listBoard: ${error.message}`);

    return (
      data as unknown as readonly {
        order_id: string;
        order_number: string;
        status: string;
        service_name_ar: string;
        city_name_ar: string | null;
        provider_name_ar: string | null;
        status_age: string;
        dispatch_round: number;
        offers_total: number;
        offers_open: number;
        attention: BoardOrder['attention'];
      }[]
    ).map((row) => ({
      orderId: row.order_id,
      orderNumber: row.order_number,
      status: row.status,
      serviceNameAr: row.service_name_ar,
      cityNameAr: row.city_name_ar,
      providerNameAr: row.provider_name_ar,
      statusAgeSeconds: intervalToSeconds(row.status_age),
      dispatchRound: row.dispatch_round,
      offersTotal: row.offers_total,
      offersOpen: row.offers_open,
      attention: row.attention,
    }));
  }

  async listProvidersForReview(status: VerificationStatus): Promise<readonly ProviderReview[]> {
    // ⚠️ Explicit column list, never `select()`. 0037 revoked
    // national_id_encrypted and iban_encrypted from every client role, and a
    // bare select asks for every column and fails the whole query rather than
    // just those two. The console has no business reading them either.
    const { data, error } = await this.client
      .from('providers')
      .select(
        'id, business_name_ar, provider_type, verification_status, nafath_verified_at, ' +
          'created_at, rating_avg, rating_count, cities(name_ar)',
      )
      .eq('verification_status', status)
      .order('created_at', { ascending: true });

    if (error !== null) throw new Error(`listProvidersForReview: ${error.message}`);

    return (data as unknown as readonly ProviderRow[]).map((row) => ({
      id: row.id,
      businessNameAr: row.business_name_ar,
      providerType: row.provider_type,
      verificationStatus: row.verification_status,
      nafathVerifiedAt: row.nafath_verified_at,
      cityNameAr: row.cities?.[0]?.name_ar ?? null,
      createdAt: row.created_at,
      ratingAvg: row.rating_avg,
      ratingCount: row.rating_count,
    }));
  }

  async listVerificationHistory(providerId: string): Promise<readonly VerificationEvent[]> {
    const { data, error } = await this.client
      .from('provider_verification_events')
      .select('id, from_status, to_status, note, created_at')
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false });

    if (error !== null) throw new Error(`listVerificationHistory: ${error.message}`);

    return (
      data as unknown as readonly {
        id: string;
        from_status: VerificationStatus | null;
        to_status: VerificationStatus;
        note: string | null;
        created_at: string;
      }[]
    ).map((row) => ({
      id: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  async setVerification(
    providerId: string,
    status: VerificationStatus,
    note?: string,
  ): Promise<void> {
    // Through the function, never a direct UPDATE: 0045 writes the status and
    // the reason in one transaction so they cannot drift apart, and refuses a
    // rejection with no stated reason.
    const { error } = await this.client.rpc('set_provider_verification', {
      p_provider_id: providerId,
      p_status: status,
      p_note: note ?? null,
    });

    if (error !== null) throw new Error(`setVerification: ${error.message}`);
  }

  async listPayouts(): Promise<readonly PayoutRow[]> {
    // No ops filter in the query: `payouts_read` (0031) already admits only the
    // provider themselves or an operator. A `.eq()` here would look like the
    // control while being none.
    const { data, error } = await this.client
      .from('payouts')
      .select(
        'id, provider_id, period_start, period_end, gross_amount, commission, ' +
          'net_amount, order_count, status, paid_at, reference, ' +
          'providers(business_name_ar)',
      )
      .order('period_end', { ascending: false })
      .limit(200);

    if (error !== null) throw new Error(`listPayouts: ${error.message}`);

    return (data as unknown as PayoutDbRow[]).map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      providerNameAr: row.providers?.business_name_ar ?? null,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      gross: money(row.gross_amount),
      commission: money(row.commission),
      net: money(row.net_amount),
      orderCount: row.order_count,
      status: row.status,
      paidAt: row.paid_at,
      reference: row.reference,
    }));
  }

  async buildPayout(providerId: string, periodStart: string, periodEnd: string): Promise<string> {
    const { data, error } = await this.client.rpc('build_payout', {
      p_provider_id: providerId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    });

    // ⚠️ Surfaced, never swallowed. `payouts_unique_period_idx` refuses a
    // second payout for the same provider and period — which is exactly the
    // "run it twice and pay twice" mistake the index exists to stop, and the
    // operator has to see that it was refused rather than assume it worked.
    if (error !== null) throw new Error(error.message);
    return data as string;
  }

  async markPayoutPaid(payoutId: string, reference: string): Promise<void> {
    // `paid_at` is set in the same statement as the status: `payouts_paid_
    // consistent` (0031) refuses a row that claims to be paid without a time,
    // so the two cannot be written apart even by accident.
    const { error } = await this.client
      .from('payouts')
      .update({ status: 'paid', paid_at: new Date().toISOString(), reference })
      .eq('id', payoutId);

    if (error !== null) throw new Error(`markPayoutPaid: ${error.message}`);
  }

  async listAuditLog(limit: number): Promise<readonly AuditEntry[]> {
    const { data, error } = await this.client
      .from('audit_log')
      .select('id, actor_id, actor_role, action, target_table, target_id, changed_columns, at, ip')
      .order('at', { ascending: false })
      .limit(limit);

    if (error !== null) throw new Error(`listAuditLog: ${error.message}`);

    return (data as unknown as AuditDbRow[]).map((row) => ({
      id: String(row.id),
      actorId: row.actor_id,
      actorRole: row.actor_role,
      action: row.action,
      targetTable: row.target_table,
      targetId: row.target_id,
      changedColumns: row.changed_columns ?? [],
      at: row.at,
      ip: row.ip,
    }));
  }

  async listPayableProviders(): Promise<
    readonly { readonly id: string; readonly nameAr: string }[]
  > {
    const { data, error } = await this.client
      .from('providers')
      .select('id, business_name_ar')
      .eq('verification_status', 'approved')
      .order('business_name_ar');

    if (error !== null) throw new Error(`listPayableProviders: ${error.message}`);
    return (data as unknown as { id: string; business_name_ar: string }[]).map((row) => ({
      id: row.id,
      nameAr: row.business_name_ar,
    }));
  }
}

/**
 * Enough of a queue to build and review the screen against, mirroring the
 * shape the server returns. Not a fixture pretending to be production data —
 * the console says which mode it is in.
 */
/**
 * PostgREST serialises an interval as `HH:MM:SS` (with days prefixed once it
 * passes one). Parsed here rather than sent as seconds from SQL, because the
 * interval is the honest type for "how long has this been stuck" and the
 * board is the only thing that needs it as a number.
 */
function intervalToSeconds(value: string): number {
  const days = /(\d+) days?/.exec(value);
  const clock = /(\d+):(\d{2}):(\d{2})/.exec(value);
  const fromDays = days !== null ? Number(days[1]) * 86_400 : 0;
  if (clock === null) return fromDays;
  return fromDays + Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Math.floor(Number(clock[3]));
}

class InMemoryOpsRepository implements OpsRepository {
  private readonly board: BoardOrder[] = [
    {
      orderId: 'ord-1',
      orderNumber: 'HB-2026-000412',
      status: 'searching',
      serviceNameAr: 'ونش/سحب',
      cityNameAr: 'الرياض',
      providerNameAr: null,
      statusAgeSeconds: 512,
      dispatchRound: 3,
      offersTotal: 4,
      offersOpen: 0,
      attention: 'search_stuck',
    },
    {
      orderId: 'ord-2',
      orderNumber: 'HB-2026-000418',
      status: 'searching',
      serviceNameAr: 'بطارية — شحن أو تبديل',
      cityNameAr: 'الدمام',
      providerNameAr: null,
      statusAgeSeconds: 47,
      dispatchRound: 1,
      offersTotal: 3,
      offersOpen: 3,
      attention: 'none',
    },
    {
      orderId: 'ord-3',
      orderNumber: 'HB-2026-000401',
      status: 'awaiting_approval',
      serviceNameAr: 'بنشر وتبديل إطار',
      cityNameAr: 'الرياض',
      providerNameAr: 'ونش الشرقية السريع',
      statusAgeSeconds: 2_640,
      dispatchRound: 1,
      offersTotal: 2,
      offersOpen: 0,
      attention: 'awaiting_customer',
    },
  ];

  async listBoard(): Promise<readonly BoardOrder[]> {
    return this.board;
  }

  private readonly providers: ProviderReview[] = [
    {
      id: 'prov-1',
      businessNameAr: 'ونش الشرقية السريع',
      providerType: 'individual',
      verificationStatus: 'pending',
      nafathVerifiedAt: '2026-08-28T09:14:00.000Z',
      cityNameAr: 'الدمام',
      createdAt: '2026-08-28T09:02:00.000Z',
      ratingAvg: 0,
      ratingCount: 0,
    },
    {
      id: 'prov-2',
      businessNameAr: 'ورشة الورود',
      providerType: 'workshop',
      verificationStatus: 'pending',
      nafathVerifiedAt: null,
      cityNameAr: 'الرياض',
      createdAt: '2026-08-30T17:41:00.000Z',
      ratingAvg: 0,
      ratingCount: 0,
    },
  ];

  private readonly history = new Map<string, VerificationEvent[]>();

  async listProvidersForReview(status: VerificationStatus): Promise<readonly ProviderReview[]> {
    return this.providers.filter((provider) => provider.verificationStatus === status);
  }

  async listVerificationHistory(providerId: string): Promise<readonly VerificationEvent[]> {
    return this.history.get(providerId) ?? [];
  }

  async setVerification(
    providerId: string,
    status: VerificationStatus,
    note?: string,
  ): Promise<void> {
    // Mirrors the server's rule rather than accepting anything, so the screen
    // behaves the same in both modes.
    if ((status === 'rejected' || status === 'suspended') && (note ?? '').trim() === '') {
      throw new Error('A rejection or suspension needs a stated reason');
    }

    const provider = this.providers.find((candidate) => candidate.id === providerId);
    if (provider === undefined) return;

    const events = this.history.get(providerId) ?? [];
    events.unshift({
      id: `evt-${events.length + 1}`,
      fromStatus: provider.verificationStatus,
      toStatus: status,
      note: note ?? null,
      createdAt: new Date().toISOString(),
    });
    this.history.set(providerId, events);

    const index = this.providers.indexOf(provider);
    this.providers[index] = { ...provider, verificationStatus: status };

    this.audit.unshift({
      id: String(this.audit.length + 1),
      actorId: 'ops-dev-1',
      actorRole: 'ops',
      action: 'UPDATE',
      targetTable: 'providers',
      targetId: providerId,
      changedColumns: ['verification_status'],
      at: new Date().toISOString(),
      ip: '127.0.0.1',
    });
  }

  /**
   * Two payouts: one sent, one waiting.
   *
   * Both states, because they are the two the screen behaves differently for —
   * a pending payout has an action on it and a paid one has a reference, and a
   * fixture with only one of them leaves half the row unexercised.
   */
  private readonly payouts: PayoutRow[] = [
    {
      id: 'payout-dev-1',
      providerId: 'prov-dev-1',
      providerNameAr: 'ورشة الخبر',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      gross: '4820.00',
      commission: '838.26',
      net: '3981.74',
      orderCount: 23,
      status: 'paid',
      paidAt: '2026-09-02T09:15:00.000Z',
      reference: 'SARIE-2026-09-02-0041',
    },
    {
      id: 'payout-dev-2',
      providerId: 'prov-dev-2',
      providerNameAr: 'فنّي الدمام',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
      gross: '1290.00',
      commission: '224.35',
      net: '1065.65',
      orderCount: 7,
      status: 'pending',
      paidAt: null,
      reference: null,
    },
  ];

  private readonly audit: AuditEntry[] = [
    {
      id: '1',
      actorId: 'ops-dev-1',
      actorRole: 'ops',
      action: 'UPDATE',
      targetTable: 'providers',
      targetId: 'prov-dev-1',
      changedColumns: ['verification_status'],
      at: new Date(Date.now() - 3_600_000).toISOString(),
      ip: '127.0.0.1',
    },
  ];

  async listPayouts(): Promise<readonly PayoutRow[]> {
    return this.payouts;
  }

  async buildPayout(providerId: string, periodStart: string, periodEnd: string): Promise<string> {
    // ⚠️ The same refusal `payouts_unique_period_idx` gives (0031). A stub that
    // happily built a second payout for a period already settled would teach
    // the screen that paying twice is possible, which is the one mistake this
    // surface exists to make hard.
    const clash = this.payouts.find(
      (row) =>
        row.providerId === providerId &&
        row.periodStart === periodStart &&
        row.periodEnd === periodEnd,
    );
    if (clash !== undefined) {
      throw new Error('A payout already exists for this provider and period');
    }

    const id = `payout-dev-${this.payouts.length + 1}`;
    this.payouts.unshift({
      id,
      providerId,
      providerNameAr:
        this.providers.find((candidate) => candidate.id === providerId)?.businessNameAr ?? null,
      periodStart,
      periodEnd,
      // Zeroes rather than invented money: the dev build has no completed
      // orders to sum, and a fixture that produced a plausible figure would be
      // the console showing an operator a number nobody earned.
      gross: '0.00',
      commission: '0.00',
      net: '0.00',
      orderCount: 0,
      status: 'pending',
      paidAt: null,
      reference: null,
    });
    return id;
  }

  async markPayoutPaid(payoutId: string, reference: string): Promise<void> {
    if (reference.trim() === '') throw new Error('A transfer reference is required');
    const index = this.payouts.findIndex((row) => row.id === payoutId);
    if (index < 0) return;
    this.payouts[index] = {
      ...(this.payouts[index] as PayoutRow),
      status: 'paid',
      paidAt: new Date().toISOString(),
      reference: reference.trim(),
    };
  }

  async listAuditLog(limit: number): Promise<readonly AuditEntry[]> {
    return this.audit.slice(0, limit);
  }

  async listPayableProviders(): Promise<
    readonly { readonly id: string; readonly nameAr: string }[]
  > {
    return this.providers
      .filter((provider) => provider.verificationStatus === 'approved')
      .map((provider) => ({ id: provider.id, nameAr: provider.businessNameAr }));
  }
}

// Bracket access: `noPropertyAccessFromIndexSignature` is on (ADR-0014), and
// env vars are an index signature — the rule exists so a typo reads as one.
const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

/** True when the console is talking to a real project rather than fixtures. */
export const isLive = url !== '' && key !== '';

export const opsRepository: OpsRepository = isLive
  ? new SupabaseOpsRepository(createClient(url, key))
  : new InMemoryOpsRepository();
