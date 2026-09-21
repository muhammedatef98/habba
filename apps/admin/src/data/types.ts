/**
 * Types for the ops console.
 *
 * A deliberately narrow view of a provider: everything ops needs to make a
 * verification decision and nothing more. The KYC blobs — `national_id_encrypted`,
 * `iban_encrypted` — are not here and must not be. 0037 revoked them from every
 * client role, and an ops console is still a client.
 */

export type VerificationStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'suspended';

export interface ProviderReview {
  readonly id: string;
  readonly businessNameAr: string;
  readonly providerType: 'individual' | 'workshop';
  readonly verificationStatus: VerificationStatus;
  /** Set by Nafath (نفاذ), never by Habba and never by the provider. */
  readonly nafathVerifiedAt: string | null;
  readonly cityNameAr: string | null;
  readonly createdAt: string;
  readonly ratingAvg: number;
  readonly ratingCount: number;
}

export interface VerificationEvent {
  readonly id: string;
  readonly fromStatus: VerificationStatus | null;
  readonly toStatus: VerificationStatus;
  readonly note: string | null;
  readonly createdAt: string;
}

/**
 * One row of `audit_log` (0064) — what an operator did, and what the record
 * used to say.
 *
 * `actorName` is resolved from `profiles`, because an id answers nobody's
 * question at 2am. `ip` is carried through exactly as the schema labels it:
 * reported by the edge, never proof of anything, and nothing here decides
 * anything from it.
 */
export interface AuditEntry {
  readonly id: string;
  readonly at: string;
  readonly actorId: string;
  readonly actorName: string | null;
  readonly action: string;
  readonly targetTable: string;
  readonly targetId: string | null;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly ip: string | null;
}

export interface OpsRepository {
  /** Live orders, ordered by trouble rather than by time (0046). */
  listBoard(): Promise<readonly BoardOrder[]>;
  /**
   * The audit trail, newest first.
   *
   * Amendment B's point is accountability, and a log only a DBA can read is
   * not that: the operator who has to notice a colleague's mistake is another
   * operator, in this console. Read-only by construction — `audit_log` has no
   * write policy and no write grant, so there is no method here that could
   * edit or remove a row, and there never will be.
   */
  listAuditLog(limit?: number): Promise<readonly AuditEntry[]>;
  listProvidersForReview(status: VerificationStatus): Promise<readonly ProviderReview[]>;
  listVerificationHistory(providerId: string): Promise<readonly VerificationEvent[]>;
  /**
   * A note is required for `rejected` and `suspended` — the server enforces it
   * (0045) and the form does too, so the operator is told before they submit
   * rather than after.
   */
  setVerification(providerId: string, status: VerificationStatus, note?: string): Promise<void>;
}

/** What the board is telling the operator to look at (0046). */
export type Attention = 'none' | 'search_stuck' | 'search_slow' | 'awaiting_customer' | 'disputed';

export interface BoardOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly serviceNameAr: string;
  readonly cityNameAr: string | null;
  readonly providerNameAr: string | null;
  /** Seconds in the current status, measured from the transition event. */
  readonly statusAgeSeconds: number;
  readonly dispatchRound: number;
  readonly offersTotal: number;
  readonly offersOpen: number;
  readonly attention: Attention;
}
