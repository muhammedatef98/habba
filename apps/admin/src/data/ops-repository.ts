/**
 * The ops console's data layer.
 *
 * Supabase when the console has been pointed at a project, in-memory
 * otherwise — the same switch as the customer app, and for the same reason:
 * the whole screen can be built and reviewed before a project exists (ADR-0010).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OpsRepository, ProviderReview, VerificationEvent, VerificationStatus } from './types';

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
class InMemoryOpsRepository implements OpsRepository {
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
