# HABBA (هبّة) — Master Build Prompt for Claude Code

> **How to use this document**
> Do **not** paste the whole file at once. This is a 6-phase build.
> Give Claude Code **Section 0–5 as permanent context** (save it as `CLAUDE.md` in the repo root),
> then issue **one phase at a time** from Section 6. Review and merge before moving on.

---

## 0. MISSION

Build **Habba (هبّة)** — a Saudi car-care super-app that connects vehicle owners with mechanics, mobile technicians, and workshops.

Arabic name: **هبّة** — double meaning: *a gust of wind* (speed) and *to rush to someone's aid* (rescue).
Latin spelling is always **Habba**. Never `Habah`, `Heba`, or `Hiba`.

**Primary market:** Saudi Arabia (launch: Eastern Province + Riyadh). Arabic-first, RTL-first.
**Secondary market (later):** Egypt, GCC.

---

## 1. THE MOAT — READ THIS BEFORE WRITING ANY CODE

The Saudi market already has roadside-assistance apps (Morni), workshop marketplaces (SOAN, Warshaty), and used-car inspection (Syarah). **Do not build another dispatch app.** Dispatch is a commodity and a race to the bottom on price.

Habba's defensible differentiator is:

### 🔑 دفتر السيارة الرقمي — The Vehicle Digital Logbook

Every vehicle gets a **permanent, immutable, owner-portable service record** keyed to its VIN and plate.

Every single interaction writes to it:
- every oil change (with mileage, oil grade, filter part number)
- every repair (with photos before/after, parts used, part serial numbers, warranty period)
- every inspection report
- every tow, every battery swap, every wash
- every warning the system raised and whether the owner acted on it

**Why this is a moat, not a feature:**

1. **Lock-in through accumulated value.** After 18 months a customer's logbook is worth more than the switching cost. They cannot take it to a competitor.
2. **Resale value — the killer app.** When the owner sells the car, they generate a **verified Habba Report** (signed PDF + public QR link). A documented car sells for meaningfully more in the Saudi used-car market. This makes Habba valuable to people who *aren't currently buying a service*.
3. **The buyer becomes a customer.** The new owner receives the logbook via ownership transfer in-app → free customer acquisition with zero CAC.
4. **Predictive maintenance from real data.** Mileage + service history + make/model → proactive alerts ("your timing belt is due in ~1,400 km"). This converts one-off emergency users into recurring subscribers.
5. **Data advantage compounds.** Real repair costs per make/model/region → accurate instant quotes no competitor can match.

**Architectural implication:** the `vehicles` table and its append-only `vehicle_timeline` are the **center of the schema**. Orders, inspections, and payments are all satellites that write to the timeline. Design everything around this. The timeline must be **append-only and tamper-evident** — never allow UPDATE or DELETE on timeline rows.

### Secondary differentiators (build these too)

| # | Feature | Why it matters |
|---|---------|----------------|
| 2 | **Three fulfilment modes in one app** | Competitors do one. Habba does on-demand mobile, scheduled mobile, and workshop booking through one order pipeline. |
| 3 | **Video triage before dispatch** | Customer records 20s of the problem/sound. Provider quotes before driving out. Kills false dispatches — the #1 cost in this business. |
| 4 | **Escrow payments** | Money is authorised at booking, captured only after the customer confirms completion. Solves the trust problem that plagues this market. |
| 5 | **Tracked warranty (ضمان)** | Every job carries a warranty period. If it fails within the window, re-service is free and auto-routed back to the same provider. Nobody does this. |
| 6 | **Transparent parts pricing** | Parts are line-itemed with part numbers, OEM vs aftermarket flagged, price shown before approval. |

---

## 2. NON-NEGOTIABLE PRINCIPLES

1. **Arabic-first, RTL-first.** Arabic is the default locale, not a translation. Build RTL from commit one — retrofitting RTL is a rewrite. English is secondary.
2. **Never trust the client.** All business logic (pricing, state transitions, matching, payouts) lives in Postgres functions or Edge Functions. The app is a thin client.
3. **RLS on every table. No exceptions.** Default deny. A missing policy must fail closed.
4. **The timeline is append-only.** Enforce with triggers and revoked grants, not convention.
5. **Money is `numeric(12,2)`,** never float. All amounts in SAR (halalas stored as decimals, not integers, for ZATCA compatibility).
6. **Every mutation is auditable.** `created_at`, `updated_at`, `created_by` on everything.
7. **Offline-tolerant.** A technician in a basement parking garage must still be able to complete a job; queue and sync.
8. **TypeScript `strict: true`.** No `any`. No `@ts-ignore` without a written reason.

---

## 3. TECH STACK — USE EXACTLY THIS

```
Mobile          Expo SDK 52+ / React Native, TypeScript strict
Routing         Expo Router (file-based)
State           TanStack Query (server state) + Zustand (UI state only)
Backend         Supabase — Postgres 15 + PostGIS, Auth, Realtime, Storage, Edge Functions
Geo             PostGIS (geography type), ST_DWithin for matching
Maps            react-native-maps (Google provider)
Payments        Moyasar  (mada + Apple Pay + Visa/MC). Escrow via authorise/capture.
Notifications   Expo Push → FCM/APNs
Identity        Nafath (نفاذ) for provider KYC — abstract behind an interface, stub in dev
i18n            i18next + expo-localization, ar-SA default, en secondary
Forms           react-hook-form + zod
Testing         Vitest (units), Detox (E2E on critical flows only)
Monorepo        pnpm workspaces
```

**Do not add** Firebase, Redux, styled-components, or any UI kit. Build the design system in-house (Section 8).

---

## 4. REPO STRUCTURE

```
habba/
├─ CLAUDE.md                    ← this document, sections 0–5
├─ apps/
│  ├─ customer/                 Expo app — vehicle owners
│  ├─ provider/                 Expo app — technicians & workshop staff
│  └─ admin/                    Next.js — ops dashboard
├─ packages/
│  ├─ core/                     shared types, zod schemas, order state machine
│  ├─ ui/                       design system (Section 8)
│  ├─ api/                      generated Supabase types + typed query layer
│  └─ i18n/                     ar/en locale files
├─ supabase/
│  ├─ migrations/               numbered SQL, forward-only
│  ├─ functions/                Edge Functions (Deno)
│  └─ seed/                     dev seed data (Saudi cities, service catalogue)
└─ docs/
   └─ adr/                      architecture decision records
```

---

## 5. DOMAIN GLOSSARY (Arabic ↔ code)

Use these exact terms in UI copy. Use the English identifiers in code.

| Arabic (UI) | Code identifier | Meaning |
|---|---|---|
| دفتر السيارة | `vehicle_logbook` | The digital logbook — the moat |
| بلاغ / طلب | `order` | A service request |
| فنّي | `technician` | Individual mobile provider |
| ورشة | `workshop` | Fixed-location provider |
| مقدّم خدمة | `provider` | Umbrella for both |
| فحص | `inspection` | Pre-purchase or periodic inspection |
| ضمان | `warranty` | Warranty on completed work |
| عرض سعر | `quote` | Provider's price offer |
| قطع غيار | `parts` | Parts line items |
| مشوار الفنّي | `dispatch` | Technician en route |
| تقرير هبّة | `habba_report` | The shareable verified vehicle report |

**Saudi-specific formats you must handle:**
- Plate numbers: 3 Arabic letters + 4 digits, with the Latin-letter equivalent (e.g. `أ ب ج ١٢٣٤` / `A B J 1234`). Store both, search both.
- IBAN: `SA` + 22 characters. Validate with mod-97.
- National ID (هوية): 10 digits starting with `1`. Iqama (إقامة): 10 digits starting with `2`.
- VAT: 15%. VAT number: 15 digits starting and ending with `3`.
- Support **Hijri dates** in display alongside Gregorian.

---

## 6. DATA MODEL

This is the authoritative schema. Implement it as numbered migrations in `supabase/migrations/`.

### 6.1 Identity & profiles

```sql
-- Supabase auth.users is the root. profiles extends it.
create type user_role as enum ('customer', 'technician', 'workshop_admin', 'ops', 'super_admin');

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          user_role not null default 'customer',
  full_name     text not null,
  phone         text not null unique,          -- E.164, +9665XXXXXXXX
  phone_verified boolean not null default false,
  email         text,
  avatar_url    text,
  preferred_locale text not null default 'ar',
  city_id       uuid references cities(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table cities (
  id        uuid primary key default gen_random_uuid(),
  name_ar   text not null,
  name_en   text not null,
  region_ar text not null,
  centroid  geography(point, 4326) not null,
  is_active boolean not null default true
);
```

### 6.2 Vehicles — THE CENTER OF THE SCHEMA

```sql
create table vehicle_makes (
  id       uuid primary key default gen_random_uuid(),
  name_ar  text not null,          -- تويوتا
  name_en  text not null,          -- Toyota
  logo_url text
);

create table vehicle_models (
  id           uuid primary key default gen_random_uuid(),
  make_id      uuid not null references vehicle_makes(id),
  name_ar      text not null,      -- كامري
  name_en      text not null,      -- Camry
  year_from    int not null,
  year_to      int,
  body_type    text                -- sedan | suv | pickup | van
);

create table vehicles (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references profiles(id) on delete cascade,
  make_id           uuid not null references vehicle_makes(id),
  model_id          uuid not null references vehicle_models(id),
  year              int  not null check (year between 1970 and extract(year from now())::int + 2),
  vin               text unique,                       -- 17 chars, nullable (not all owners know it)
  plate_ar          text,                              -- أ ب ج ١٢٣٤
  plate_en          text,                              -- A B J 1234
  colour            text,
  current_mileage   int  not null default 0,
  mileage_updated_at timestamptz,
  nickname          text,                              -- "سيارة الشغل"
  photo_url         text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint plate_or_vin check (vin is not null or plate_en is not null)
);

create index on vehicles (owner_id) where is_active;
create index on vehicles (vin);
create index on vehicles (plate_en);
```

#### The append-only timeline

```sql
create type timeline_event_type as enum (
  'service_completed', 'inspection_completed', 'parts_replaced',
  'mileage_recorded',  'warranty_claimed',     'ownership_transferred',
  'alert_raised',      'alert_dismissed',      'vehicle_registered'
);

create table vehicle_timeline (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references vehicles(id) on delete restrict,
  event_type     timeline_event_type not null,
  occurred_at    timestamptz not null default now(),
  mileage        int,
  order_id       uuid references orders(id),
  provider_id    uuid references providers(id),
  -- denormalised snapshot: the timeline must survive deletion of the source row
  summary_ar     text not null,
  summary_en     text not null,
  details        jsonb not null default '{}'::jsonb,
  attachments    jsonb not null default '[]'::jsonb,   -- [{url, type, caption}]
  -- tamper evidence
  prev_hash      text,
  row_hash       text not null,
  created_at     timestamptz not null default now()
);

create index on vehicle_timeline (vehicle_id, occurred_at desc);

-- Append-only enforcement
create rule timeline_no_update as on update to vehicle_timeline do instead nothing;
create rule timeline_no_delete as on delete to vehicle_timeline do instead nothing;

-- Hash chain: row_hash = sha256(prev_hash || vehicle_id || event_type || occurred_at || details)
-- Implement in a BEFORE INSERT trigger. This makes the logbook verifiable.
```

> **Implementation note:** the hash chain is what makes تقرير هبّة trustworthy to a used-car buyer. Compute `prev_hash` from the most recent row for that `vehicle_id`. Expose a `verify_vehicle_timeline(vehicle_id)` function that walks the chain and returns validity.

#### Ownership transfer — the acquisition loop

```sql
create table ownership_transfers (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references vehicles(id),
  from_owner_id  uuid not null references profiles(id),
  to_phone       text not null,                    -- may not be a user yet
  to_owner_id    uuid references profiles(id),
  status         text not null default 'pending',  -- pending | accepted | expired | cancelled
  otp_code_hash  text not null,
  expires_at     timestamptz not null,
  accepted_at    timestamptz,
  created_at     timestamptz not null default now()
);
```

### 6.3 Service catalogue

```sql
create type service_category as enum ('emergency', 'periodic', 'inspection', 'wash', 'bodywork');
create type fulfilment_mode  as enum ('mobile_ondemand', 'mobile_scheduled', 'workshop');

create table services (
  id                 uuid primary key default gen_random_uuid(),
  category           service_category not null,
  name_ar            text not null,
  name_en            text not null,
  description_ar     text,
  icon               text not null,
  supported_modes    fulfilment_mode[] not null,
  base_price         numeric(12,2),          -- null = quote-only
  price_is_fixed     boolean not null default false,
  est_duration_min   int not null,
  requires_lift      boolean not null default false,   -- forces workshop mode
  requires_vehicle   boolean not null default true,    -- false for pre-purchase inspection
  sort_order         int not null default 0,
  is_active          boolean not null default true
);
```

**Seed the catalogue with at least these:**

| Category | Services |
|---|---|
| `emergency` | ونش/سحب، بطارية (شحن/تبديل)، بنشر/تبديل إطار، فتح أبواب، توصيل بنزين، سخونة رادياتير |
| `periodic` | تغيير زيت وفلتر، فلتر هواء، فحص فرامل، تبديل بطارية، تبديل إطارات، فحص تكييف |
| `inspection` | فحص قبل الشراء (شامل)، فحص دوري، فحص كمبيوتر |
| `wash` | غسيل متنقل، تلميع، تنظيف داخلي، حماية سيراميك |
| `bodywork` | سمكرة، دهان، إصلاح خدوش، تبديل زجاج |

### 6.4 Providers

```sql
create type provider_type as enum ('individual', 'workshop');
create type verification_status as enum ('pending', 'in_review', 'approved', 'rejected', 'suspended');

create table providers (
  id                  uuid primary key default gen_random_uuid(),
  owner_profile_id    uuid not null references profiles(id),
  provider_type       provider_type not null,
  business_name_ar    text not null,
  business_name_en    text,
  cr_number           text,                       -- السجل التجاري (workshops)
  vat_number          text,                       -- 15 digits
  national_id         text,                       -- individuals; encrypted at rest
  iban                text,                       -- encrypted at rest
  verification_status verification_status not null default 'pending',
  nafath_verified_at  timestamptz,
  rating_avg          numeric(3,2) not null default 0,
  rating_count        int not null default 0,
  jobs_completed      int not null default 0,
  acceptance_rate     numeric(5,2),
  is_online           boolean not null default false,
  city_id             uuid not null references cities(id),
  created_at          timestamptz not null default now()
);

create table provider_services (
  provider_id  uuid not null references providers(id) on delete cascade,
  service_id   uuid not null references services(id),
  custom_price numeric(12,2),
  primary key (provider_id, service_id)
);

-- Live location for on-demand matching
create table provider_locations (
  provider_id  uuid primary key references providers(id) on delete cascade,
  location     geography(point, 4326) not null,
  heading      numeric(5,2),
  updated_at   timestamptz not null default now()
);
create index on provider_locations using gist (location);

create table workshops (
  provider_id      uuid primary key references providers(id) on delete cascade,
  address_ar       text not null,
  location         geography(point, 4326) not null,
  bay_count        int not null default 1,
  service_radius_km int,                    -- for mobile units they dispatch
  opening_hours    jsonb not null,          -- {"sun": [["08:00","22:00"]], ...}
  photos           jsonb not null default '[]'::jsonb
);
create index on workshops using gist (location);
```

### 6.5 Orders — one pipeline, three modes

```sql
create type order_status as enum (
  'draft', 'searching', 'quoted', 'accepted', 'en_route', 'arrived',
  'in_progress', 'awaiting_approval', 'completed', 'cancelled', 'disputed'
);

create table orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique,        -- HB-2026-000123
  customer_id         uuid not null references profiles(id),
  vehicle_id          uuid references vehicles(id),  -- null for pre-purchase inspection
  service_id          uuid not null references services(id),
  fulfilment_mode     fulfilment_mode not null,
  status              order_status not null default 'draft',
  provider_id         uuid references providers(id),

  -- location
  service_location    geography(point, 4326),      -- customer location (mobile modes)
  service_address_ar  text,
  workshop_id         uuid references workshops(id),

  -- scheduling
  scheduled_for       timestamptz,
  slot_id             uuid references appointment_slots(id),

  -- triage
  problem_description text,
  triage_media        jsonb not null default '[]'::jsonb,   -- video/photo URLs
  mileage_at_order    int,

  -- money
  quoted_amount       numeric(12,2),
  parts_amount        numeric(12,2) not null default 0,
  labour_amount       numeric(12,2) not null default 0,
  vat_amount          numeric(12,2) not null default 0,
  total_amount        numeric(12,2),
  payment_intent_id   text,
  escrow_status       text,                        -- authorised | captured | released | refunded

  -- warranty
  warranty_days       int,
  warranty_expires_at timestamptz,
  parent_order_id     uuid references orders(id),  -- warranty re-service

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint mode_location check (
    (fulfilment_mode in ('mobile_ondemand','mobile_scheduled') and service_location is not null)
    or (fulfilment_mode = 'workshop' and workshop_id is not null)
  )
);

create table order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status  order_status not null,
  actor_id   uuid references profiles(id),
  note       text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table order_parts (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  name_ar       text not null,
  part_number   text,
  is_oem        boolean not null default false,
  quantity      int not null default 1,
  unit_price    numeric(12,2) not null,
  warranty_days int,
  approved_by_customer boolean not null default false,
  approved_at   timestamptz
);
```

**Order state machine — enforce in a Postgres trigger, not in the app:**

```
draft → searching → quoted → accepted → en_route → arrived
      → in_progress → awaiting_approval → completed
any → cancelled (with rules)
completed → disputed (within 72h)
```

Rules:
- `quoted → accepted` requires a payment authorisation.
- `in_progress → awaiting_approval` requires all `order_parts` approved by customer if `parts_amount > 0`.
- `awaiting_approval → completed` may only be triggered by the **customer**, or automatically after 24h of no response.
- `completed` **must** write a `vehicle_timeline` row inside the same transaction. This is non-negotiable.
- `workshop` mode skips `en_route`/`arrived`; use `checked_in` semantics via `order_events`.

### 6.6 Appointment slots (workshop + scheduled mobile)

```sql
create table appointment_slots (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references providers(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  capacity     int not null default 1,
  booked_count int not null default 0,
  is_blocked   boolean not null default false,
  constraint capacity_ok check (booked_count <= capacity)
);
create unique index on appointment_slots (provider_id, starts_at);
```

Booking must use `SELECT ... FOR UPDATE` or an atomic `UPDATE ... WHERE booked_count < capacity` to prevent double-booking under concurrency. Write a test for this.

### 6.7 Inspections — structured reports

```sql
create table inspection_templates (
  id       uuid primary key default gen_random_uuid(),
  name_ar  text not null,
  sections jsonb not null   -- [{key, title_ar, items:[{key,label_ar,type,required}]}]
);

create table inspection_reports (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id),
  vehicle_id    uuid references vehicles(id),
  template_id   uuid not null references inspection_templates(id),
  -- for pre-purchase, the car isn't owned yet:
  subject_vin   text,
  subject_plate text,
  results       jsonb not null,     -- {section_key: {item_key: {rating, note, photos[]}}}
  overall_score int check (overall_score between 0 and 100),
  recommendation text,              -- buy | negotiate | avoid
  pdf_url       text,
  public_token  text unique,        -- shareable read-only link
  completed_at  timestamptz
);
```

**Inspection template must cover at minimum:** المحرك، ناقل الحركة، الفرامل، التعليق، الكهرباء، الإطارات، الهيكل والشاسيه، الفرش الداخلي، التكييف، فحص الكمبيوتر (OBD codes)، تاريخ الحوادث.

### 6.8 Ratings, payments, disputes

```sql
create table ratings (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references orders(id),
  rater_id    uuid not null references profiles(id),
  provider_id uuid not null references providers(id),
  stars       int not null check (stars between 1 and 5),
  tags        text[],            -- ['سرعة','نظافة','سعر عادل']
  comment     text,
  created_at  timestamptz not null default now()
);

create table payouts (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(id),
  period_start  date not null,
  period_end    date not null,
  gross_amount  numeric(12,2) not null,
  commission    numeric(12,2) not null,
  net_amount    numeric(12,2) not null,
  status        text not null default 'pending',
  paid_at       timestamptz
);

create table zatca_invoices (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references orders(id),
  invoice_number text not null unique,
  invoice_xml  text not null,
  qr_base64    text not null,
  invoice_hash text not null,
  issued_at    timestamptz not null default now()
);
```

> **ZATCA note:** Saudi e-invoicing (فاتورة) Phase 2 requires a TLV-encoded QR containing seller name, VAT number, timestamp, total with VAT, and VAT amount. Implement the TLV encoder in an Edge Function. Do not skip this — it is a legal requirement for B2B and for workshops.

### 6.9 RLS — default deny

Enable RLS on **every** table. Baseline policies:

- `profiles`: a user reads/updates only their own row. `ops` reads all.
- `vehicles`: owner full access. A provider may read a vehicle **only** while they have a non-terminal order on it.
- `vehicle_timeline`: owner reads all. Provider reads only rows from their own orders. **Insert only via `security definer` function** — never direct.
- `orders`: customer reads own; provider reads own assigned + open orders in their city matching their services during `searching`.
- `provider_locations`: readable only by the customer of an active order with that provider.
- `inspection_reports`: owner + assigned provider; plus anonymous read when `public_token` matches.

Write a `tests/rls.spec.ts` that asserts, for each table, that a random authenticated user **cannot** read another user's rows. This test must run in CI.

---

## 7. CORE ALGORITHMS

### 7.1 On-demand matching (the 60-second promise)

Implement as a Postgres function `match_providers(order_id)` returning a ranked list.

```
1. Candidate set:
   - provider.is_online = true
   - verification_status = 'approved'
   - offers the requested service_id
   - ST_DWithin(provider_location, order.service_location, radius)
     radius starts at 8km, expands 8 → 15 → 25km if no acceptance in 45s

2. Ranking score (0–100):
   distance_score   40%   (closer is better, linear decay to radius)
   rating_score     25%   (rating_avg, providers with <5 ratings get 3.5 baseline)
   acceptance_score 15%   (historical acceptance_rate)
   idle_score       10%   (longer idle = higher, prevents winner-take-all)
   specialisation   10%   (has completed this service on this make before)

3. Broadcast to top 5 simultaneously. First to accept wins.
   If none accept in 45s → expand radius, re-broadcast.
   After 3 rounds → escalate to ops, notify customer honestly.
```

**Anti-patterns to avoid:** do not assign to a single provider and wait. Do not rank by price alone. Do not let a provider see the customer's exact address before accepting — show approximate distance only.

### 7.2 Predictive maintenance engine

An Edge Function on a daily cron:

```
For each active vehicle:
  1. Estimate current mileage:
     daily_rate = (latest_mileage - previous_mileage) / days_between
     estimated_now = latest_mileage + daily_rate * days_since
  2. For each maintenance rule (make/model/generic):
       due_at_km, due_every_km, due_every_months
  3. Compare against the last matching timeline event
  4. If within 500km or 14 days of due → create an alert
  5. Alert becomes a one-tap booking with the correct service pre-selected
```

Store rules in a `maintenance_rules` table so ops can tune them without a deploy. Seed with generic intervals (oil 5–10k km, air filter 20k, brake fluid 40k, timing belt 90–150k depending on model) — flag them as `confidence: 'generic'` vs `'oem'`.

**Product rule:** never send more than one alert per vehicle per week. Alert fatigue kills this feature.

### 7.3 تقرير هبّة — the shareable report

```
generate_habba_report(vehicle_id) →
  - walks vehicle_timeline, verifies the hash chain
  - renders an Arabic RTL PDF:
      vehicle identity, ownership duration (not owner identity — privacy)
      service history table, parts replaced with part numbers
      inspection scores over time, mileage progression chart
      warranty status, verification QR
  - stores in Supabase Storage, returns a public_token URL
  - the public page must work without login and be mobile-first
```

**Privacy rule:** the report shows the *car's* history, never the owner's name, phone, or addresses. Redact provider names to business names only.

---

## 8. DESIGN SYSTEM

Build in `packages/ui`. Do not use a third-party kit.

### Direction & typography
- `I18nManager.forceRTL(true)` at boot; handle the required reload.
- Use **logical** properties everywhere: `marginStart`/`marginEnd`, never `marginLeft`/`marginRight`.
- Icons that imply direction (arrows, chevrons, progress) must mirror in RTL. Icons that don't (car, wrench) must **not**.
- Arabic font: **IBM Plex Sans Arabic** or **Tajawal**. Latin numerals by default (Saudi users prefer `1234` over `١٢٣٤` in UI), but Hijri dates displayed alongside Gregorian.
- Arabic needs more line-height than Latin: `lineHeight = fontSize * 1.7`.

### Visual direction
The category is full of generic blue "trust" apps and aggressive red "emergency" apps. **Do neither.**

Habba's identity comes from its name — *a gust of wind, a rush to aid*. Suggested direction:
- Primary: a deep desert teal / petrol (`#0E4F4A`-ish family) — calm competence, not panic
- Accent: warm sand/amber for CTAs — reads as Saudi without being cliché
- Semantic red reserved **exclusively** for genuine emergencies. Never for marketing.
- Generous whitespace, large touch targets (min 48dp) — people use this one-handed, stressed, at the roadside, sometimes at night.
- **Dark mode is not optional.** Half of emergency usage happens after sunset.

### Motion
Movement should suggest *wind*: eased, directional, never bouncy. Use `react-native-reanimated`. The dispatch tracking screen is the emotional core of the product — invest in it.

---

## 9. APP SURFACES

### 9.1 Customer app

| Screen | Notes |
|---|---|
| Onboarding | Phone OTP. Add first vehicle in ≤3 taps (make → model → year). Plate optional at first. |
| Home | Vehicle switcher at top. Two primary actions: **طلب طارئ** (one tap) and **حجز موعد**. Predictive alerts surface here. |
| Emergency flow | Service → location confirm → optional 20s video triage → searching animation → provider matched → live tracking |
| Booking flow | Service → mode (mobile/workshop) → provider or slot → confirm |
| Live tracking | Map + ETA + provider card + call/chat. This screen must feel *excellent*. |
| Quote approval | Line-itemed parts + labour, each part with OEM flag and price. Approve/reject per line. |
| **دفتر السيارة** | The timeline. Chronological, filterable, with photos. **This is the app's soul — design it first, not last.** |
| Report | Generate/share تقرير هبّة |
| Wallet & invoices | ZATCA invoices downloadable |

### 9.2 Provider app

| Screen | Notes |
|---|---|
| Onboarding & KYC | ID/Iqama + IBAN + Nafath. Status tracking while in review. |
| Online toggle | Prominent. Location broadcast only while online (battery + privacy). |
| Incoming order | Full-screen with sound, 45s countdown, distance + service + estimated payout. Never show exact address pre-acceptance. |
| Job flow | Navigate → arrived → diagnose → build quote (parts + labour) → await approval → work → complete with photos |
| Completion | **Mandatory:** mileage reading + before/after photos + parts used. This is what feeds the logbook — enforce it. |
| Earnings | Daily/weekly, payout schedule, commission breakdown |

### 9.3 Workshop console (inside provider app)
Slot calendar, bay management, staff assignment, walk-in orders.

### 9.4 Admin (Next.js)
Provider verification queue, live order map, dispute resolution, pricing/rules tuning, payout runs, fraud flags.

---

## 10. PHASED BUILD — ISSUE ONE PHASE AT A TIME

> Do not start a phase before the previous one's acceptance criteria pass.

### PHASE 1 — Foundation
Monorepo, Supabase project, migrations for §6.1–6.2, auth with phone OTP, RTL shell, design system primitives, i18n scaffolding, CI with lint + typecheck + RLS test.

**Acceptance:** a user signs up with a Saudi phone number, adds a vehicle, sees an empty logbook. RLS test passes. App runs RTL in Arabic and LTR in English.

### PHASE 2 — The logbook (build the moat first)
Timeline schema with hash chain, manual entry (owner logs their own past service), mileage tracking, timeline UI, `verify_vehicle_timeline`, تقرير هبّة PDF + public page.

**Acceptance:** an owner records 3 past services manually, generates a report, opens the public link in a browser, and the hash chain verifies. **Ship this to real users before building orders** — it has standalone value and validates the moat.

### PHASE 3 — On-demand emergency
Service catalogue, provider onboarding + KYC stub, matching function, order state machine, live tracking, escrow authorise/capture, completion → timeline write, ratings.

**Acceptance:** end-to-end emergency order on two devices, completed job appears in the logbook automatically, payment captured only after customer confirmation.

### PHASE 4 — Scheduled & workshop
Slots with concurrency safety, workshop profiles, booking flow, check-in semantics, warranty tracking and auto-routing.

**Acceptance:** two clients cannot book the same slot (prove with a concurrent test). A warranty claim within the window creates a free child order routed to the original provider.

### PHASE 5 — Inspections
Templates, structured capture with photos, scoring, PDF, public share, pre-purchase flow with no owned vehicle, buyer→owner conversion on purchase.

**Acceptance:** a pre-purchase inspection produces a shareable report; if the buyer purchases, the report converts into a new `vehicles` row with the inspection as its first timeline event.

### PHASE 6 — Intelligence & compliance
Predictive maintenance cron, alert→booking conversion, ZATCA invoicing, payouts, admin dashboard, analytics.

**Acceptance:** a vehicle with history receives a correctly-timed alert; a completed order produces a ZATCA-valid invoice with a scannable QR.

---

## 11. WHAT NOT TO DO

- ❌ Do not build a chat-first or bidding-first experience. Bidding races to the bottom and Saudi users want a price, not an auction.
- ❌ Do not let providers set arbitrary prices for `emergency` services. Fix those prices centrally — trust at the roadside is everything.
- ❌ Do not gate the logbook behind a paywall or behind having ordered a service. Free logbook = top of funnel.
- ❌ Do not store national IDs or IBANs in plaintext. Use Supabase Vault / pgsodium.
- ❌ Do not skip the completion photos/mileage. Without them the moat is empty.
- ❌ Do not build web before mobile. This market is mobile-only.
- ❌ Do not add ride-hailing, fuel delivery subscriptions, or car sales in v1. Focus.

---

## 12. DEFINITION OF DONE (every PR)

- [ ] TypeScript strict, no `any`
- [ ] RLS policy written and tested for any new table
- [ ] Arabic strings in `packages/i18n` — no hardcoded text
- [ ] Verified in RTL **and** LTR, light **and** dark
- [ ] Money uses `numeric`, never float
- [ ] Any status change goes through the state machine, never a direct UPDATE
- [ ] Errors surfaced to the user in Arabic, plainly, with a next action
