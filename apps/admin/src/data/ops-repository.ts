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
  ProviderReview,
  VerificationEvent,
  VerificationStatus,
} from './types';

/**
 * How many audit rows one screenful is.
 *
 * A page rather than everything: this table only grows, and an operator
 * opening the tab six months in should not wait for a year of it.
 */
const AUDIT_PAGE = 100;

interface AuditRow {
  readonly id: string;
  readonly at: string;
  readonly actor_id: string;
  readonly action: string;
  readonly target_table: string;
  readonly target_id: string | null;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly ip: string | null;
  readonly profiles: { readonly full_name: string } | null;
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

  async listAuditLog(limit = AUDIT_PAGE): Promise<readonly AuditEntry[]> {
    // Explicit columns on the embed too. `profiles` is not a KYC table, but
    // the habit is the point: a bare `profiles(*)` here would put an
    // operator's phone number on a screen that exists to show what they did.
    const { data, error } = await this.client
      .from('audit_log')
      .select(
        'id, at, actor_id, action, target_table, target_id, before, after, ip, ' +
          'profiles(full_name)',
      )
      .order('at', { ascending: false })
      .limit(limit);

    if (error !== null) throw new Error(`listAuditLog: ${error.message}`);

    return (data as unknown as readonly AuditRow[]).map((row) => ({
      id: row.id,
      at: row.at,
      actorId: row.actor_id,
      // Null rather than a fallback name: an audit row whose actor cannot be
      // resolved is a thing to notice, not to paper over with "غير معروف".
      actorName: row.profiles?.full_name ?? null,
      action: row.action,
      targetTable: row.target_table,
      targetId: row.target_id,
      before: row.before,
      after: row.after,
      ip: row.ip,
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

  /**
   * The dev console's audit rows.
   *
   * Written by `setVerification` below rather than seeded, so the tab shows
   * the same thing it will show in production: nothing until somebody does
   * something, and then exactly what they did. A seeded log would let the
   * screen be built against rows no action produced.
   */
  private readonly audit: AuditEntry[] = [];

  async listProvidersForReview(status: VerificationStatus): Promise<readonly ProviderReview[]> {
    return this.providers.filter((provider) => provider.verificationStatus === status);
  }

  async listVerificationHistory(providerId: string): Promise<readonly VerificationEvent[]> {
    return this.history.get(providerId) ?? [];
  }

  async listAuditLog(limit = AUDIT_PAGE): Promise<readonly AuditEntry[]> {
    return this.audit.slice(0, limit);
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

    // 0064 writes this row inside `set_provider_verification`, in the same
    // transaction as the decision. Mirrored here, curated the same way — no
    // whole-row snapshot — so the screen is built against the shape the
    // server actually produces.
    this.audit.unshift({
      id: `audit-${this.audit.length + 1}`,
      at: new Date().toISOString(),
      actorId: 'dev-operator',
      actorName: 'مشغّل التطوير',
      action: `provider.${status}`,
      targetTable: 'providers',
      targetId: providerId,
      before: { verification_status: provider.verificationStatus, is_online: false },
      after: {
        verification_status: status,
        is_online: false,
        ...((note ?? '').trim() === '' ? {} : { note: (note ?? '').trim() }),
      },
      // No edge in front of the dev console, so no forwarded address. Null is
      // what the server records in the same situation, and a fabricated
      // address here would be the one field on this screen that lies.
      ip: null,
    });
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
