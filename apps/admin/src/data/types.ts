/**
 * What the console reads, in the shapes the server returns them (0070).
 *
 * Field names stay snake_case, as the database writes them: these are display
 * records, and a rename layer between the function and the screen would be a
 * second place for a field to be misspelt. The exceptions are the board and
 * the audit log, which predate this file and are mapped.
 *
 * KYC ciphertext is not in any of these types and must never be. 0037 closed
 * those columns to every client; an ops console is still a client.
 */

export type OrderStatus =
  | 'draft'
  | 'searching'
  | 'quoted'
  | 'accepted'
  | 'checked_in'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'awaiting_approval'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export type FulfilmentMode = 'mobile_ondemand' | 'mobile_scheduled' | 'workshop';
export type EscrowStatus = 'none' | 'authorised' | 'captured' | 'released' | 'refunded' | 'failed';
export type VerificationStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'suspended';
export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'failed';
export type StaffRole = 'ops' | 'super_admin';

export interface Dashboard {
  readonly orders_today: number;
  readonly completed_today: number;
  readonly active_now: number;
  readonly searching_now: number;
  readonly disputes_open: number;
  readonly gmv_today: number;
  readonly gmv_7d: number;
  readonly gmv_30d: number;
  readonly orders_7d: number;
  readonly cancelled_7d: number;
  readonly providers_online: number;
  readonly providers_approved: number;
  readonly pending_verifications: number;
  readonly customers_total: number;
  readonly customers_new_7d: number;
  readonly vehicles_total: number;
  readonly pending_payment_operations: number;
  readonly suspended_accounts: number;
  readonly avg_rating_30d: number | null;
  readonly new_orders_paused: boolean;
  readonly by_day: readonly {
    readonly day: string;
    readonly orders: number;
    readonly completed: number;
    readonly gmv: number;
  }[];
}

export interface SearchHit {
  readonly kind: 'order' | 'user' | 'vehicle' | 'provider';
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status: string;
}

export interface OrderRow {
  readonly id: string;
  readonly order_number: string;
  readonly status: OrderStatus;
  readonly fulfilment_mode: FulfilmentMode;
  readonly service_name_ar: string;
  readonly customer_id: string;
  readonly customer_name: string;
  readonly customer_phone: string | null;
  readonly provider_id: string | null;
  readonly provider_name_ar: string | null;
  readonly total_amount: number | null;
  readonly refunded_amount: number;
  readonly escrow_status: EscrowStatus;
  readonly created_at: string;
  readonly total_count: number;
}

export interface Note {
  readonly id: string;
  readonly body: string;
  readonly author_name: string | null;
  readonly created_at: string;
}

export interface OrderPart {
  readonly id: string;
  readonly name_ar: string;
  readonly part_number: string | null;
  readonly is_oem: boolean;
  readonly quantity: number;
  readonly unit_price: number;
  readonly approved_by_customer: boolean;
  readonly declined_at: string | null;
}

export interface Dispute {
  readonly id: string;
  readonly order_id: string;
  readonly reason: string;
  readonly opened_at: string;
  readonly resolution: 'upheld' | 'partial_refund' | 'full_refund' | null;
  readonly refund_amount: number | null;
  readonly resolution_note: string | null;
  readonly resolved_at: string | null;
  readonly payout_already_built: boolean;
}

export interface PaymentOperation {
  readonly id: string;
  readonly order_id: string;
  readonly kind: 'void' | 'refund' | 'capture';
  readonly amount: number;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly reason: string;
  readonly created_at: string;
  readonly processed_at: string | null;
  readonly psp_reference: string | null;
  readonly last_error: string | null;
  // Present in the finance list, not in an order's file.
  readonly order_number?: string;
  readonly payment_intent_id?: string | null;
  readonly customer_name?: string;
  readonly requested_by_name?: string | null;
}

export interface OrderFile {
  readonly order: {
    readonly id: string;
    readonly order_number: string;
    readonly status: OrderStatus;
    readonly fulfilment_mode: FulfilmentMode;
    readonly service_address_ar: string | null;
    readonly problem_description: string | null;
    readonly scheduled_for: string | null;
    readonly quoted_amount: number | null;
    readonly labour_amount: number;
    readonly parts_amount: number;
    readonly vat_amount: number;
    readonly total_amount: number | null;
    readonly refunded_amount: number;
    readonly escrow_status: EscrowStatus;
    readonly payment_intent_id: string | null;
    readonly warranty_days: number | null;
    readonly warranty_expires_at: string | null;
    readonly dispatch_round: number;
    readonly mileage_at_order: number | null;
    readonly completion_mileage: number | null;
    readonly completion_media: readonly { readonly url: string; readonly kind: string }[];
    readonly triage_media: readonly unknown[];
    readonly cancellation_reason: string | null;
    readonly completed_at: string | null;
    readonly cancelled_at: string | null;
    readonly created_at: string;
    readonly lat: number | null;
    readonly lon: number | null;
  };
  readonly service: { readonly id: string; readonly name_ar: string; readonly category: string };
  readonly customer: {
    readonly id: string;
    readonly full_name: string;
    readonly phone: string | null;
    readonly email: string | null;
    readonly suspended: boolean;
  } | null;
  readonly provider: {
    readonly id: string;
    readonly business_name_ar: string;
    readonly provider_type: 'individual' | 'workshop';
    readonly owner_profile_id: string;
    readonly phone: string | null;
    readonly verification_status: VerificationStatus;
    readonly rating_avg: number;
    readonly is_online: boolean;
  } | null;
  readonly vehicle: {
    readonly id: string;
    readonly plate_ar: string;
    readonly plate_en: string;
    readonly vin: string | null;
    readonly year: number;
    readonly make_ar: string | null;
    readonly model_ar: string | null;
  } | null;
  readonly events: readonly {
    readonly from: OrderStatus | null;
    readonly to: OrderStatus;
    readonly actor_name: string | null;
    readonly note: string | null;
    readonly at: string;
  }[];
  readonly parts: readonly OrderPart[];
  readonly offers: readonly {
    readonly provider_id: string;
    readonly provider_name_ar: string;
    readonly round: number;
    readonly radius_m: number;
    readonly sent_at: string;
    readonly viewed_at: string | null;
    readonly responded_at: string | null;
    readonly outcome: string;
  }[];
  readonly handover: { readonly attempts: number; readonly verified_at: string | null } | null;
  readonly rating: {
    readonly id: string;
    readonly stars: number;
    readonly comment: string | null;
    readonly hidden_at: string | null;
  } | null;
  readonly invoices: readonly {
    readonly id: string;
    readonly invoice_number: string;
    readonly invoice_type: string;
    readonly total_amount: number;
    readonly issued_at: string;
  }[];
  readonly disputes: readonly Dispute[];
  readonly payment_operations: readonly PaymentOperation[];
  /** Every hold on the customer's card: from booking, and any top-up (0078). */
  readonly payment_holds: readonly {
    readonly payment_id: string;
    readonly amount: number;
    readonly kind: 'initial' | 'top_up';
    readonly status: 'authorised' | 'captured' | 'voided' | 'expired';
    readonly created_at: string;
  }[];
  readonly payout: { readonly payout_id: string; readonly status: PayoutStatus } | null;
  readonly parent_order: { readonly id: string; readonly order_number: string } | null;
  readonly notes: readonly Note[];
}

export interface UserRow {
  readonly id: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly is_guest: boolean;
  readonly roles: readonly string[];
  readonly suspended: boolean;
  readonly orders_count: number;
  readonly created_at: string;
  readonly total_count: number;
}

export interface UserFile {
  readonly profile: {
    readonly id: string;
    readonly full_name: string;
    readonly phone: string | null;
    readonly email: string | null;
    readonly is_guest: boolean;
    readonly preferred_locale: string;
    readonly created_at: string;
  };
  readonly roles: readonly {
    readonly role: string;
    readonly granted_at: string;
    readonly revoked_at: string | null;
    readonly granted_by_name: string | null;
  }[];
  readonly suspensions: readonly {
    readonly id: string;
    readonly reason: string;
    readonly suspended_at: string;
    readonly suspended_by_name: string | null;
    readonly lifted_at: string | null;
    readonly lift_note: string | null;
  }[];
  readonly suspended: boolean;
  readonly vehicles: readonly {
    readonly id: string;
    readonly plate_ar: string;
    readonly plate_en: string;
    readonly year: number;
    readonly make_ar: string | null;
    readonly model_ar: string | null;
    readonly is_active: boolean;
    readonly current_mileage: number | null;
  }[];
  readonly orders: readonly BriefOrder[];
  readonly provider: {
    readonly id: string;
    readonly business_name_ar: string;
    readonly verification_status: VerificationStatus;
  } | null;
  readonly devices: readonly {
    readonly platform: string;
    readonly last_seen_at: string;
    readonly disabled_at: string | null;
  }[];
  readonly transfers: readonly {
    readonly id: string;
    readonly vehicle_id: string;
    readonly status: string;
    readonly direction: 'in' | 'out';
    readonly created_at: string;
  }[];
  readonly ratings_given: number;
  readonly data_requests: readonly {
    readonly kind: 'export' | 'erasure';
    readonly reason: string;
    readonly handled_at: string;
  }[];
  readonly notes: readonly Note[];
}

export interface BriefOrder {
  readonly id: string;
  readonly order_number: string;
  readonly status: OrderStatus;
  readonly service_name_ar: string;
  readonly amount: number | null;
  readonly created_at: string;
}

export interface ProviderRow {
  readonly id: string;
  readonly business_name_ar: string;
  readonly provider_type: 'individual' | 'workshop';
  readonly verification_status: VerificationStatus;
  readonly city_name_ar: string | null;
  readonly owner_profile_id: string;
  readonly owner_phone: string | null;
  readonly is_online: boolean;
  readonly rating_avg: number;
  readonly rating_count: number;
  readonly jobs_completed: number;
  readonly nafath_verified_at: string | null;
  readonly suspended: boolean;
  readonly created_at: string;
  readonly total_count: number;
}

export interface ProviderFile {
  readonly provider: {
    readonly id: string;
    readonly business_name_ar: string;
    readonly business_name_en: string | null;
    readonly provider_type: 'individual' | 'workshop';
    readonly cr_number: string | null;
    readonly vat_number: string | null;
    readonly verification_status: VerificationStatus;
    readonly nafath_verified_at: string | null;
    readonly rating_avg: number;
    readonly rating_count: number;
    readonly jobs_completed: number;
    readonly acceptance_rate: number | null;
    readonly is_online: boolean;
    readonly created_at: string;
    readonly has_national_id: boolean;
    readonly has_iban: boolean;
  };
  readonly owner: {
    readonly id: string;
    readonly full_name: string;
    readonly phone: string | null;
    readonly email: string | null;
    readonly suspended: boolean;
  };
  readonly city: { readonly id: string; readonly name_ar: string } | null;
  readonly services: readonly {
    readonly service_id: string;
    readonly name_ar: string;
    readonly base_price: number | null;
    readonly custom_price: number | null;
    readonly offered: boolean;
  }[];
  readonly workshop: {
    readonly address_ar: string;
    readonly bay_count: number;
    readonly service_radius_km: number | null;
  } | null;
  readonly location: {
    readonly lat: number;
    readonly lon: number;
    readonly updated_at: string;
  } | null;
  readonly verification_events: readonly {
    readonly from: VerificationStatus | null;
    readonly to: VerificationStatus;
    readonly note: string | null;
    readonly actor_name: string | null;
    readonly at: string;
  }[];
  readonly ratings: readonly {
    readonly id: string;
    readonly stars: number;
    readonly comment: string | null;
    readonly tags: readonly string[] | null;
    readonly hidden_at: string | null;
    readonly hidden_reason: string | null;
    readonly created_at: string;
  }[];
  readonly orders: readonly BriefOrder[];
  readonly stats: {
    readonly completed: number;
    readonly cancelled: number;
    readonly disputed: number;
    readonly earned: number;
    readonly offers_sent: number;
    readonly offers_accepted: number;
  };
  readonly payouts: readonly Payout[];
  readonly notes: readonly Note[];
}

export interface TimelineEntry {
  readonly id: string;
  readonly seq: number;
  readonly event_type: string;
  readonly occurred_at: string;
  readonly mileage: number | null;
  readonly provenance: 'self_reported' | 'self_documented' | 'habba_verified' | 'third_party';
  readonly summary_ar: string;
  readonly order_id: string | null;
  readonly attachments: number;
  readonly row_hash: string;
}

export interface VehicleFile {
  readonly vehicle: {
    readonly id: string;
    readonly plate_ar: string;
    readonly plate_en: string;
    readonly vin: string | null;
    readonly year: number;
    readonly colour: string | null;
    readonly nickname: string | null;
    readonly current_mileage: number | null;
    readonly is_active: boolean;
    readonly created_at: string;
    readonly make_ar: string | null;
    readonly model_ar: string | null;
  };
  readonly owner: {
    readonly id: string;
    readonly full_name: string;
    readonly phone: string | null;
  } | null;
  readonly timeline: readonly TimelineEntry[];
  readonly transfers: readonly {
    readonly id: string;
    readonly status: string;
    readonly to_phone: string | null;
    readonly to_email: string | null;
    readonly created_at: string;
    readonly expires_at: string;
    readonly accepted_at: string | null;
    readonly failed_attempts: number;
    readonly locked_at: string | null;
  }[];
  readonly reports: readonly {
    readonly id: string;
    readonly generated_at: string;
    readonly expires_at: string | null;
    readonly revoked_at: string | null;
    readonly chain_valid: boolean;
    readonly chain_length: number;
  }[];
  readonly documents: readonly {
    readonly id: string;
    readonly doc_type: string;
    readonly expires_at: string;
    readonly note: string | null;
  }[];
  readonly orders: readonly BriefOrder[];
  readonly notes: readonly Note[];
}

export interface DisputeRow extends Dispute {
  readonly order_number: string;
  readonly service_name_ar: string;
  readonly customer_name: string;
  readonly provider_name_ar: string | null;
  readonly total_amount: number | null;
  readonly refunded_amount: number;
}

export interface RatingRow {
  readonly id: string;
  readonly order_id: string;
  readonly order_number: string;
  readonly stars: number;
  readonly comment: string | null;
  readonly tags: readonly string[] | null;
  readonly created_at: string;
  readonly hidden_at: string | null;
  readonly hidden_reason: string | null;
  readonly rater_name: string;
  readonly provider_name_ar: string | null;
  readonly provider_id: string | null;
}

export interface Payout {
  readonly id: string;
  readonly provider_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly gross_amount: number;
  readonly commission: number;
  readonly net_amount: number;
  readonly order_count: number;
  readonly status: PayoutStatus;
  readonly paid_at: string | null;
  readonly reference: string | null;
  readonly created_at: string;
  readonly provider_name_ar?: string;
  readonly provider_has_iban?: boolean;
}

export interface FinanceSummary {
  readonly orders: number;
  readonly gross: number;
  readonly refunded: number;
  readonly net_of_vat: number;
  readonly vat: number;
  readonly held_authorised: number;
  readonly payouts_pending: number;
  readonly payouts_paid: number;
  readonly commission: number;
}

export interface StaffMember {
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly role: StaffRole;
  readonly granted_at: string;
  readonly granted_by_name: string | null;
}

export type RecordKind = 'broadcasts' | 'data_requests' | 'transfers' | 'reports' | 'notifications';

export interface Setting {
  readonly key: string;
  readonly value: unknown;
  readonly value_type: 'integer' | 'number' | 'boolean' | 'text';
  readonly min_value: number | null;
  readonly max_value: number | null;
  readonly is_public: boolean;
  readonly category: string;
  readonly label_ar: string;
  readonly unit_ar: string | null;
  readonly description_ar: string | null;
  readonly sort_order: number;
  readonly updated_at: string;
}

/** One change an operator made (0068), or one file they opened (0070). */
export interface AuditEntry {
  readonly id: string;
  readonly actorName: string;
  readonly action: 'insert' | 'update' | 'delete' | 'read';
  readonly targetTable: string;
  readonly targetId: string;
  readonly changes: readonly {
    readonly field: string;
    readonly from: string | null;
    readonly to: string | null;
  }[];
  readonly ip: string | null;
  readonly at: string;
}

/** What the board is telling the operator to look at (0053). */
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
