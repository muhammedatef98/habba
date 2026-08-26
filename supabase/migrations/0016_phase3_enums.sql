-- 0016 — Phase 3 enumerated types
-- Build prompt §6.3–6.5.

create type service_category as enum ('emergency', 'periodic', 'inspection', 'wash', 'bodywork');
create type fulfilment_mode  as enum ('mobile_ondemand', 'mobile_scheduled', 'workshop');

create type provider_type as enum ('individual', 'workshop');
create type verification_status as enum ('pending', 'in_review', 'approved', 'rejected', 'suspended');

-- ADR-0006. `checked_in` is included in the ORIGINAL create, as that ADR
-- required: the build prompt says workshop orders "skip en_route/arrived and
-- use checked_in semantics via order_events", but order_events.to_status is
-- typed order_status, so without this value the instruction is not
-- implementable. Adding an enum value after deployment is materially more
-- awkward than including it now.
create type order_status as enum (
  'draft',
  'searching',
  'quoted',
  'accepted',
  'checked_in',        -- workshop mode only: the vehicle is physically here
  'en_route',
  'arrived',
  'in_progress',
  'awaiting_approval',
  'completed',
  'cancelled',
  'disputed'
);

-- Free text in the spec; typed here so an invalid state cannot be written.
-- Values reflect the delayed-capture model in ADR-0008; if the merchant-of-
-- record decision lands differently, this enum changes with it.
create type escrow_status as enum (
  'none',
  'authorised',
  'captured',
  'released',
  'refunded',
  'failed'
);
