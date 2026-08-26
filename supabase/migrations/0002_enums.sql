-- 0002 — Enumerated types for Phase 1
--
-- ADR-0002 planned a single "all enums" migration. Phasing overrides that:
-- creating types for tables that will not exist until Phase 3 is speculative
-- (YAGNI), so each phase creates the types it needs.
--
-- ⚠️ CARRY FORWARD TO PHASE 3: when `order_status` is created it MUST include
-- 'checked_in' in the original CREATE TYPE (ADR-0006). Workshop orders skip
-- en_route/arrived and need a real state for "vehicle is physically here".
-- Adding an enum value after deployment is materially more awkward than
-- including it from the start.

-- Build prompt §6.1
create type user_role as enum (
  'customer',
  'technician',
  'workshop_admin',
  'ops',
  'super_admin'
);

-- Build prompt §6.2
create type timeline_event_type as enum (
  'vehicle_registered',
  'service_completed',
  'inspection_completed',
  'parts_replaced',
  'mileage_recorded',
  'warranty_claimed',
  'ownership_transferred',
  'alert_raised',
  'alert_dismissed'
);

-- ADR-0005 — the distinction between "recorded in Habba" and "verified by Habba".
--
-- A hash chain proves a row has not changed since it was written. It proves
-- nothing about whether the row was ever true. تقرير هبّة is sold on being
-- trustworthy to a used-car buyer, so the difference between an owner typing
-- "timing belt replaced" and a Habba-dispatched technician documenting it with
-- photos and a mileage reading has to be visible in the data, in the UI, and
-- on the report.
--
-- This column is non-null and part of the hashed payload. Because the timeline
-- is append-only, it cannot be added meaningfully after rows exist.
create type timeline_provenance as enum (
  'self_reported',    -- owner typed it; no evidence attached
  'self_documented',  -- owner typed it and attached an invoice or photo
  'habba_verified',   -- produced by a completed Habba order
  'third_party'       -- imported from a dealership, insurer, or government source
);
