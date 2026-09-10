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

export interface OpsRepository {
  /** Live orders, ordered by trouble rather than by time (0046). */
  listBoard(): Promise<readonly BoardOrder[]>;
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
