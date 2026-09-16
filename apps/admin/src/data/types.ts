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

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'failed';

/**
 * One settlement run for one provider.
 *
 * ⚠️ `net` is carried, never derived here. `payouts_reconcile` (0031) is a
 * CHECK constraint — `net_amount = gross_amount - commission` — and a console
 * that recomputed the subtraction would be a second implementation of the
 * arithmetic that pays somebody, drifting the moment the commission rule
 * changes. The three numbers are shown because a provider will ask about all
 * three, and they are shown as the database holds them.
 */
export interface PayoutRow {
  readonly id: string;
  readonly providerId: string;
  readonly providerNameAr: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly gross: string;
  readonly commission: string;
  readonly net: string;
  readonly orderCount: number;
  readonly status: PayoutStatus;
  readonly paidAt: string | null;
  readonly reference: string | null;
}

/**
 * One row of the immutable ops record (0070, Amendment B §5.1.6).
 *
 * `before`/`after` carry only the columns that actually changed — 0070 is
 * explicit that a full row copy of `providers` would pull
 * `national_id_encrypted` into a table with different access rules, turning
 * the audit log into a second and less guarded copy of the KYC vault.
 */
export interface AuditEntry {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly targetTable: string;
  readonly targetId: string | null;
  readonly changedColumns: readonly string[];
  readonly at: string;
  readonly ip: string | null;
}

/**
 * One row of the service catalogue.
 *
 * ⚠️ `basePrice` is nullable and that is a real state, not missing data: 0017
 * uses null for "quote only", a service whose price the provider sets per job
 * because it cannot be known up front — bodywork, a tow of unknown distance.
 * A console that rendered null as `0.00` would be advertising free labour.
 */
export interface ServiceRow {
  readonly id: string;
  readonly category: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly basePrice: string | null;
  readonly estDurationMin: number;
  readonly supportedModes: readonly string[];
  readonly isActive: boolean;
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

  /**
   * الدفعات. What providers are owed, and what has been sent.
   *
   * ⚠️ `buildPayout` is the only way a payout row comes into existence, and it
   * is a server function (`build_payout`, rebuilt in 0067) rather than an
   * insert: it reads `payable_order_lines`, sums the commission per line, and
   * writes one row inside one transaction. A console that assembled the
   * numbers itself and inserted them would be deciding what somebody is paid
   * from a browser.
   */
  listPayouts(): Promise<readonly PayoutRow[]>;
  buildPayout(providerId: string, periodStart: string, periodEnd: string): Promise<string>;
  /**
   * Marks a payout sent, with the bank's reference.
   *
   * The reference is required and that is not a formality: it is the only
   * thing that connects a row in this table to money that actually left an
   * account, and the first thing anybody asks for when a provider says they
   * were not paid.
   */
  markPayoutPaid(payoutId: string, reference: string): Promise<void>;

  /** سجلّ التدقيق — every ops write, newest first (0070). Read-only, always. */
  listAuditLog(limit: number): Promise<readonly AuditEntry[]>;
  /** The providers a payout can be built for — approved ones, by name. */
  listPayableProviders(): Promise<readonly { readonly id: string; readonly nameAr: string }[]>;

  /**
   * الخدمات. The catalogue every price in the app comes from.
   *
   * ⚠️ Editing this changes what customers are quoted from the next booking
   * onwards, and changes NOTHING about an order already placed: `orders`
   * carries its own `quoted_amount`, captured when the order was made. That is
   * the property that makes this screen safe to have — a price correction can
   * never re-price work somebody already agreed to.
   */
  listServices(): Promise<readonly ServiceRow[]>;
  setServicePrice(serviceId: string, basePrice: string | null): Promise<void>;
  /**
   * Takes a service off the menu, or puts it back.
   *
   * Not a delete, and there is no delete: `orders.service_id` is a foreign key,
   * so removing a service would orphan every order that ever used it — and the
   * logbook entries those orders wrote are the product. `is_active = false`
   * hides it from customers (`services_read`, 0022) and leaves the history
   * intact.
   */
  setServiceActive(serviceId: string, isActive: boolean): Promise<void>;

  /**
   * Cancels an order from the board, with a stated reason.
   *
   * For the one case the board exists to surface: a request nobody can serve,
   * sitting in `searching` while a customer waits next to a broken-down car.
   * The reason is required because the customer will be told something, and
   * "cancelled by ops" with no sentence behind it is not something to tell
   * them.
   */
  cancelOrder(orderId: string, reason: string): Promise<void>;
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
