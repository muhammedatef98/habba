/**
 * Everything the console can read and do, as typed calls.
 *
 * One function per server function (0070), named for what the operator is
 * doing. Each action takes the reason the server requires; the screens ask
 * for it before calling, so the operator is told the rule rather than
 * discovering it from a refusal.
 */

import { opsClient } from '@/lib/ops-session';
import { changedFields, intervalToSeconds } from './audit';
import { FixtureTransport } from './fixtures';
import { SupabaseTransport, type ListOptions, type Row, type Transport } from './transport';
import type {
  AuditEntry,
  BoardOrder,
  Dashboard,
  DisputeRow,
  FinanceSummary,
  OrderFile,
  OrderRow,
  PaymentOperation,
  Payout,
  PayoutStatus,
  ProviderFile,
  ProviderRow,
  RatingRow,
  RecordKind,
  SearchHit,
  Setting,
  StaffMember,
  StaffRole,
  UserFile,
  UserRow,
  VehicleFile,
  VerificationStatus,
} from './types';

/** True when the console is talking to a real project rather than demo data. */
export const isLive = opsClient !== null;

export const PAGE_SIZE = 50;

export interface OrderFilter {
  readonly status?: string;
  readonly query?: string;
  readonly mode?: string;
  readonly from?: string;
  readonly to?: string;
  readonly offset?: number;
}

/**
 * The console's calls over a transport. Built once for the app (below); the
 * integration test builds its own over a signed-in test session, so the
 * parameter names here are checked against the real functions, not assumed.
 */
export function createApi(transport: Transport) {
  return {
    // -- Overview ---------------------------------------------------------------
    dashboard: () => transport.rpc<Dashboard>('ops_dashboard'),

    search: (query: string) => transport.rpc<SearchHit[]>('ops_search', { p_query: query }),

    async board(): Promise<readonly BoardOrder[]> {
      const rows = await transport.rpc<
        {
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
      >('ops_active_orders');
      return rows.map((row) => ({
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
    },

    // -- Orders ---------------------------------------------------------------------
    orders: (filter: OrderFilter) =>
      transport.rpc<OrderRow[]>('ops_list_orders', {
        p_status: filter.status || null,
        p_query: filter.query || null,
        p_mode: filter.mode || null,
        p_from: filter.from || null,
        p_to: filter.to || null,
        p_limit: PAGE_SIZE,
        p_offset: filter.offset ?? 0,
      }),

    order: (id: string) => transport.rpc<OrderFile>('ops_order_detail', { p_order_id: id }),

    cancelOrder: (id: string, reason: string) =>
      transport.rpc<void>('ops_cancel_order', { p_order_id: id, p_reason: reason }),

    confirmCompletion: (id: string, reason: string) =>
      transport.rpc<void>('ops_confirm_completion', { p_order_id: id, p_reason: reason }),

    assignProvider: (id: string, providerId: string, reason: string) =>
      transport.rpc<void>('ops_assign_provider', {
        p_order_id: id,
        p_provider_id: providerId,
        p_reason: reason,
      }),

    retryDispatch: (id: string) => transport.rpc<number>('ops_retry_dispatch', { p_order_id: id }),

    /** For a completed order completion could not invoice (no seller configured then). */
    issueInvoice: (id: string) => transport.rpc<string>('ops_issue_invoice', { p_order_id: id }),

    openDispute: (id: string, reason: string) =>
      transport.rpc<void>('ops_open_dispute', { p_order_id: id, p_reason: reason }),

    resolveDispute: (
      id: string,
      resolution: 'upheld' | 'partial_refund' | 'full_refund',
      refundAmount: number | null,
      note: string,
    ) =>
      transport.rpc<void>('ops_resolve_dispute', {
        p_order_id: id,
        p_resolution: resolution,
        p_refund_amount: refundAmount,
        p_note: note,
      }),

    disputes: (open: boolean | null) =>
      transport.rpc<DisputeRow[]>('ops_list_disputes', { p_open: open }),

    // -- People -------------------------------------------------------------------------
    users: (query: string, filter: string, offset: number) =>
      transport.rpc<UserRow[]>('ops_list_users', {
        p_query: query || null,
        p_filter: filter,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      }),

    user: (id: string) => transport.rpc<UserFile>('ops_user_detail', { p_user_id: id }),

    setSuspension: (id: string, suspend: boolean, reason: string) =>
      transport.rpc<void>('ops_set_suspension', {
        p_user_id: id,
        p_suspend: suspend,
        p_reason: reason,
      }),

    rename: (id: string, fullName: string) =>
      transport.rpc<void>('ops_update_profile', { p_user_id: id, p_full_name: fullName }),

    setStaffRole: (id: string, role: StaffRole, grant: boolean) =>
      transport.rpc<void>('ops_set_staff_role', { p_user_id: id, p_role: role, p_grant: grant }),

    staff: () => transport.rpc<StaffMember[]>('ops_list_staff'),

    exportUserData: (id: string, reason: string) =>
      transport.rpc<Record<string, unknown>>('ops_export_user_data', {
        p_user_id: id,
        p_reason: reason,
      }),

    anonymiseUser: (id: string, reason: string) =>
      transport.rpc<void>('ops_anonymise_user', { p_user_id: id, p_reason: reason }),

    addNote: (table: 'orders' | 'profiles' | 'providers' | 'vehicles', id: string, body: string) =>
      transport.rpc<void>('ops_add_note', { p_table: table, p_id: id, p_body: body }),

    // -- Providers ---------------------------------------------------------------------------
    providers: (status: string, query: string, online: boolean | null, offset: number) =>
      transport.rpc<ProviderRow[]>('ops_list_providers', {
        p_status: status || null,
        p_query: query || null,
        p_online: online,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      }),

    provider: (id: string) =>
      transport.rpc<ProviderFile>('ops_provider_detail', { p_provider_id: id }),

    /** Through the function, never a direct UPDATE: status and reason in one transaction (0052). */
    setVerification: (id: string, status: VerificationStatus, note: string | null) =>
      transport.rpc<void>('set_provider_verification', {
        p_provider_id: id,
        p_status: status,
        p_note: note,
      }),

    forceOffline: (id: string, reason: string) =>
      transport.rpc<void>('ops_force_offline', { p_provider_id: id, p_reason: reason }),

    setProviderService: (
      providerId: string,
      serviceId: string,
      offered: boolean,
      price: number | null,
    ) =>
      transport.rpc<void>('ops_set_provider_service', {
        p_provider_id: providerId,
        p_service_id: serviceId,
        p_offered: offered,
        p_custom_price: price,
      }),

    // -- Cars ---------------------------------------------------------------------------------------
    vehicle: (id: string) => transport.rpc<VehicleFile>('ops_vehicle_detail', { p_vehicle_id: id }),

    annotateVehicle: (id: string, note: string) =>
      transport.rpc<string>('ops_annotate_vehicle', {
        p_vehicle_id: id,
        p_note_ar: note,
        p_note_en: null,
      }),

    setVehicleActive: (id: string, active: boolean, reason: string) =>
      transport.rpc<void>('ops_set_vehicle_active', {
        p_vehicle_id: id,
        p_active: active,
        p_reason: reason,
      }),

    revokeReport: (id: string, reason: string) =>
      transport.rpc<void>('ops_revoke_report', { p_report_id: id, p_reason: reason }),

    cancelTransfer: (id: string, reason: string) =>
      transport.rpc<void>('ops_cancel_transfer', { p_transfer_id: id, p_reason: reason }),

    // -- Reviews ---------------------------------------------------------------------------------------
    ratings: (hiddenOnly: boolean) =>
      transport.rpc<RatingRow[]>('ops_list_ratings', { p_hidden_only: hiddenOnly, p_limit: 200 }),

    setRatingHidden: (id: string, hidden: boolean, reason: string | null) =>
      transport.rpc<void>('ops_set_rating_hidden', {
        p_rating_id: id,
        p_hidden: hidden,
        p_reason: reason,
      }),

    // -- Money ---------------------------------------------------------------------------------------------
    financeSummary: (from: string, to: string) =>
      transport.rpc<FinanceSummary>('ops_finance_summary', { p_from: from, p_to: to }),

    paymentOperations: (status: string | null) =>
      transport.rpc<PaymentOperation[]>('ops_list_payment_operations', { p_status: status }),

    recordPaymentOperation: (
      id: string,
      status: 'succeeded' | 'failed',
      reference: string,
      error: string | null,
    ) =>
      transport.rpc<void>('ops_record_payment_operation', {
        p_operation_id: id,
        p_status: status,
        p_reference: reference,
        p_error: error,
      }),

    payouts: (status: string | null) =>
      transport.rpc<Payout[]>('ops_list_payouts', { p_status: status }),

    buildPayout: (providerId: string, from: string, to: string) =>
      transport.rpc<string>('build_payout', {
        p_provider_id: providerId,
        p_period_start: from,
        p_period_end: to,
      }),

    setPayoutStatus: (id: string, status: PayoutStatus, reference: string | null) =>
      transport.rpc<void>('ops_set_payout_status', {
        p_payout_id: id,
        p_status: status,
        p_reference: reference,
      }),

    // -- Telling people -----------------------------------------------------------------------------------
    broadcast: (
      audience: 'all' | 'customers' | 'providers' | 'city',
      cityId: string | null,
      titleAr: string,
      bodyAr: string,
      titleEn: string,
      bodyEn: string,
    ) =>
      transport.rpc<number>('ops_broadcast', {
        p_audience: audience,
        p_city_id: cityId,
        p_title_ar: titleAr,
        p_body_ar: bodyAr,
        p_title_en: titleEn,
        p_body_en: bodyEn,
      }),

    records: <T>(kind: RecordKind) =>
      transport.rpc<T[]>('ops_list_records', { p_kind: kind, p_limit: 200 }),

    // -- Settings and catalogue -------------------------------------------------------------------------------
    settings: () =>
      transport.list<Setting & Row>('platform_settings', { order: 'sort_order', ascending: true }),

    updateSetting: (key: string, value: unknown) =>
      transport.update('platform_settings', { key }, { value }),

    table: <T extends Row>(table: string, options?: ListOptions) =>
      transport.list<T>(table, options),
    insertRow: (table: string, row: Row) => transport.insert(table, row),
    updateRow: (table: string, match: Row, patch: Row) => transport.update(table, match, patch),
    deleteRow: (table: string, match: Row) => transport.remove(table, match),

    // -- Accountability ------------------------------------------------------------------------------------------
    async auditLog(limit: number, table?: string): Promise<readonly AuditEntry[]> {
      const rows = await transport.list<AuditRow & Row>('audit_log', {
        columns: 'id, actor_id, action, target_table, target_id, before, after, ip, at',
        order: 'at',
        ascending: false,
        limit,
        ...(table !== undefined && table !== '' ? { eq: { target_table: table } } : {}),
      });

      const actorIds = [...new Set(rows.map((row) => row.actor_id))];
      const names = new Map<string, string>();
      if (actorIds.length > 0) {
        const profiles = await transport.list<{ id: string; full_name: string } & Row>('profiles', {
          columns: 'id, full_name',
          in: { id: actorIds },
        });
        for (const profile of profiles) names.set(profile.id, profile.full_name);
      }

      return rows.map((row) => ({
        id: String(row.id),
        actorName: names.get(row.actor_id) ?? row.actor_id,
        action: row.action,
        targetTable: row.target_table,
        targetId: row.target_id,
        changes: changedFields(row.before, row.after),
        ip: row.ip,
        at: row.at,
      }));
    },
  };
}

export type ConsoleApi = ReturnType<typeof createApi>;

// The session's own client, never a second one: a second client keeps its own
// session store, and its requests would reach the database as nobody.
export const api: ConsoleApi = createApi(
  opsClient !== null ? new SupabaseTransport(opsClient) : new FixtureTransport(),
);

interface AuditRow {
  readonly id: number;
  readonly actor_id: string;
  readonly action: AuditEntry['action'];
  readonly target_table: string;
  readonly target_id: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly ip: string | null;
  readonly at: string;
}
