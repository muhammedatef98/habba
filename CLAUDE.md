# HABBA (هبّة) — Permanent Project Context

> **This file is the permanent context for the Habba project.**
> It contains Sections 0–5.1 of `HABBA_BUILD_PROMPT.md` (Mission → App Topology), verbatim.
> §5.1 carries Amendments A (single app, multiple roles) and B (admin stays separate).
> **Re-read this file at the start of every session before doing anything else.**
> Sections 6–12 of the build prompt (data model, algorithms, design system, app surfaces,
> phased build, anti-goals, definition of done) are issued **one phase at a time** and are not
> duplicated here. The build prompt is the authoritative source; this is its stable subset.

---

## 0. MISSION

Build **Habba (هبّة)** — a Saudi car-care super-app that connects vehicle owners with mechanics, mobile technicians, and workshops.

Arabic name: **هبّة** — double meaning: _a gust of wind_ (speed) and _to rush to someone's aid_ (rescue).
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
2. **Resale value — the killer app.** When the owner sells the car, they generate a **verified Habba Report** (signed PDF + public QR link). A documented car sells for meaningfully more in the Saudi used-car market. This makes Habba valuable to people who _aren't currently buying a service_.
3. **The buyer becomes a customer.** The new owner receives the logbook via ownership transfer in-app → free customer acquisition with zero CAC.
4. **Predictive maintenance from real data.** Mileage + service history + make/model → proactive alerts ("your timing belt is due in ~1,400 km"). This converts one-off emergency users into recurring subscribers.
5. **Data advantage compounds.** Real repair costs per make/model/region → accurate instant quotes no competitor can match.

**Architectural implication:** the `vehicles` table and its append-only `vehicle_timeline` are the **center of the schema**. Orders, inspections, and payments are all satellites that write to the timeline. Design everything around this. The timeline must be **append-only and tamper-evident** — never allow UPDATE or DELETE on timeline rows.

### Secondary differentiators (build these too)

| #   | Feature                               | Why it matters                                                                                                                                      |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | **Three fulfilment modes in one app** | Competitors do one. Habba does on-demand mobile, scheduled mobile, and workshop booking through one order pipeline.                                 |
| 3   | **Video triage before dispatch**      | Customer records 20s of the problem/sound. Provider quotes before driving out. Kills false dispatches — the #1 cost in this business.               |
| 4   | **Escrow payments**                   | Money is authorised at booking, captured only after the customer confirms completion. Solves the trust problem that plagues this market.            |
| 5   | **Tracked warranty (ضمان)**           | Every job carries a warranty period. If it fails within the window, re-service is free and auto-routed back to the same provider. Nobody does this. |
| 6   | **Transparent parts pricing**         | Parts are line-itemed with part numbers, OEM vs aftermarket flagged, price shown before approval.                                                   |

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
9. **Roles are server-side facts, not client state.** One app serves customers and providers (§5.1); what a user may _do_ is decided by `user_roles` and RLS. The client's role knowledge decides only what it renders.
10. **Ops code never ships to a phone.** Admin is a separate web app. A role check is not a boundary; a separate bundle is.

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
├─ CLAUDE.md                    ← this document, sections 0–5.1
├─ apps/
│  ├─ mobile/                   Expo app — ONE app, customers and providers
│  │  └─ src/features/
│  │     ├─ customer/           customer-only screens, hooks, data
│  │     ├─ provider/           provider-only screens, hooks, data
│  │     └─ shared/             anything used by both
│  └─ admin/                    Next.js — ops dashboard (web only, never bundled into mobile)
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

| Arabic (UI)  | Code identifier   | Meaning                               |
| ------------ | ----------------- | ------------------------------------- |
| دفتر السيارة | `vehicle_logbook` | The digital logbook — the moat        |
| بلاغ / طلب   | `order`           | A service request                     |
| فنّي         | `technician`      | Individual mobile provider            |
| ورشة         | `workshop`        | Fixed-location provider               |
| مقدّم خدمة   | `provider`        | Umbrella for both                     |
| فحص          | `inspection`      | Pre-purchase or periodic inspection   |
| ضمان         | `warranty`        | Warranty on completed work            |
| عرض سعر      | `quote`           | Provider's price offer                |
| قطع غيار     | `parts`           | Parts line items                      |
| مشوار الفنّي | `dispatch`        | Technician en route                   |
| تقرير هبّة   | `habba_report`    | The shareable verified vehicle report |

**Saudi-specific formats you must handle:**

- Plate numbers: 3 Arabic letters + 4 digits, with the Latin-letter equivalent (e.g. `أ ب ج ١٢٣٤` / `A B J 1234`). Store both, search both.
- IBAN: `SA` + 22 characters. Validate with mod-97.
- National ID (هوية): 10 digits starting with `1`. Iqama (إقامة): 10 digits starting with `2`.
- VAT: 15%. VAT number: 15 digits starting and ending with `3`.
- Support **Hijri dates** in display alongside Gregorian.

---

## 5.1 APP TOPOLOGY — ONE MOBILE APP, MANY ROLES

> **Amendment A + B.** This supersedes any earlier statement that customers and
> providers get separate mobile apps.

### 5.1.1 One app, one account, many roles

There is **one** mobile app: `apps/mobile`. It serves vehicle owners and
providers alike. One account per phone number, holding zero or more roles.

- Everyone signs up as `customer`. **Signup asks no role question** — there is no
  "are you a customer or a technician?" screen, ever.
- `provider` is granted **only** when that user's `providers` record reaches
  `verification_status = 'approved'`. It is never self-selected and never
  granted by the client.
- Becoming a provider is an **in-app upgrade** from the profile screen:
  **«اشتغل معنا كفنّي»** → KYC (هوية/إقامة, IBAN, Nafath) → review → approval.
  The user keeps their account, their vehicles, and their logbook throughout.
- A user may hold both roles at once and switch between them. That is the normal
  case, not an edge case: a technician owns a car too.

### 5.1.2 Roles live in a join table, never in a column

`profiles.role` (a single enum column) is **replaced** by:

```sql
user_roles(user_id, role, granted_at, revoked_at, granted_by)
```

A role is held when a row exists for it with `revoked_at is null`. Revocation is
a timestamp, never a `DELETE` — role history is auditable like everything else
(§2.6). Every RLS policy, helper function and trigger that referenced
`profiles.role` must be rewritten against `user_roles`.

### 5.1.3 Roles are enforced on the server. Always.

**The client's opinion about its own roles is worthless.** It exists only to
decide what to render.

- RLS checks for an **approved provider record**, not a claim in a JWT, a
  request body, or a column the user can write.
- A customer-only user must be unable to read `orders` in `searching`,
  `provider_locations`, `payouts`, or any earnings surface — **even with a
  hand-crafted request** that bypasses the app entirely.
- Prove it in `tests/rls.spec.ts`. A role check that only exists in TypeScript
  is not a role check.

### 5.1.4 Routing and the mode switcher

Expo Router route groups: `(customer)` and `(provider)`.

- The mode switcher is visible **only** to users holding an approved `provider`
  role. A customer-only user must never see the switcher, a provider tab, or any
  provider UI.
- The last active mode is persisted and restored on launch.
- Switching mode changes which route group is mounted. It does not re-authenticate
  and does not change the user's identity.

### 5.1.5 Code separation despite the single app

One app is a shipping decision, not an architectural excuse.

```
apps/mobile/src/features/customer/**
apps/mobile/src/features/provider/**
apps/mobile/src/features/shared/**
```

- `customer/**` and `provider/**` **must never import from each other.**
- Only `shared/**` may be imported by both.
- Enforce with ESLint (`eslint-plugin-boundaries`, or `no-restricted-imports`
  with path patterns). **This must fail CI**, not merely warn.

### 5.1.6 Admin stays a separate web app — non-negotiable

`apps/admin` is a Next.js **web** app and stays one. Ops functionality is never
merged into `apps/mobile`, not even behind a role check: code behind a role check
still ships to every user's device, where it can be read and probed.

- Runs locally in development and deploys to Vercel **with zero code changes** —
  the only difference is environment variables. No hardcoded URLs, no hardcoded
  keys, no `if (production)` branches.
- `SUPABASE_SERVICE_ROLE_KEY` is **server-only**: route handlers and server
  components exclusively. Never in a client component, never prefixed
  `NEXT_PUBLIC_`. A CI check fails the build if it appears anywhere reachable
  from the client bundle.
- **2FA is mandatory** on admin accounts. Sessions expire after **8 hours**.
  There is no "remember me".
- Every admin action writes an immutable audit row:
  `audit_log(actor_id, action, target_table, target_id, before, after, ip, at)`.
- `apps/admin/README.md` documents local setup and Vercel deployment.
