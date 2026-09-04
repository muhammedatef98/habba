# ADR-0016 — Roles as a join table, and one app for both audiences

- **Status:** Accepted (implemented in migration 0040/0041)
- **Date:** 2026-09-04
- **Relates to:** ADR-0003, ADR-0005, ADR-0013, CLAUDE.md §5.1

## Context

The original schema gave `profiles` a `role` column: one enum, one role per
person, set at signup. The app was split to match — `apps/customer` and
`apps/provider`, two binaries, two bundle identifiers, two installs.

Three things were wrong with that, and they are the reason for Amendment A.

**A person is not one role.** A technician owns a car. A workshop owner has a
logbook. Under the column, serving both meant two accounts, two phone numbers,
and a logbook that belongs to whichever account happened to record the service.

**A role grant is the most audit-worthy write in the system**, and the column
recorded none of it. Who granted this, when, on what evidence, and when was it
taken away — the questions asked after a fraud incident — had no answers.
§2.6 requires every mutation to be auditable; this one was not.

**Signup asked the wrong question.** "Are you a customer or a technician?" on
a signup screen is a role the user picks, which means it is a claim, which
means it cannot be trusted for anything. Meanwhile the real signal — an
approved KYC record — already existed and was not what the app read.

## Decision

**Roles move to `user_roles(user_id, role, granted_at, revoked_at, granted_by)`.**

- A role is held when a row exists with `revoked_at is null`. A partial unique
  index enforces at most one live grant per (user, role).
- Revocation sets a timestamp; it is never a `DELETE`. `granted_at` is part of
  the primary key, so a re-grant after revocation is a second row and the
  history survives. `granted_at` defaults to `clock_timestamp()`, not `now()`,
  because a revoke-and-regrant inside one transaction would otherwise collide
  on the key and the second grant would vanish — the same trap the timeline hit
  with `recorded_at` (ADR-0004).
- `user_roles` is closed to clients three ways, matching ADR-0003's layering:
  no write policy, no write grant, and an `ENABLE ALWAYS` trigger that refuses
  writes outside `begin_privileged_write()` — so a leaked service key does not
  walk through either.
- `has_role()`, `is_ops()` and `is_provider()` are the only sanctioned reads.

**`customer` is granted by a trigger on profile insert.** In the database, so
it is true however a profile was created and there is no code path where signup
could ask.

**Approval — and only approval — grants a provider role.** An `AFTER UPDATE`
trigger on `providers` derives `technician` / `workshop_admin` from
`verification_status = 'approved'` in the same transaction. Suspension or
rejection revokes it, with no client action and no token refresh: the next
request simply fails the policy.

**One mobile app** (`apps/mobile`), with `(customer)` and `(provider)` route
groups and a mode switcher rendered only for a held provider role.

## Consequences

**The client's role knowledge decides only what it renders.** The provider
route group's guard exists so a customer-only user never _sees_ provider UI. It
is not what stops them _reading_ provider data — RLS is, and RLS does not
consult anything on the device. `tests/rls.spec.ts` asserts this with raw HTTP.

**Two real holes closed on the way.** `current_provider_id()` matched any
`providers` row, so a self-registered applicant held provider-side RLS access —
the open-order feed, live locations — before anyone had looked at their ID. And
`providers` had no uniqueness on `owner_profile_id`, so one user could hold
several records, making "your application status" a question with several
answers and giving a rejected applicant an obvious retry.

**Code separation is now a lint rule, not a directory convention.**
`features/customer/**` and `features/provider/**` cannot import each other, and
`features/shared/**` may import neither — otherwise `customer → shared →
provider` defeats the rule. It is an error, so CI fails on it.

**Ops stays out of the bundle.** `apps/admin` remains a separate Next.js app.
A role check is not a boundary: code behind one still ships to every device,
where it can be read and probed.

## Alternatives considered

**Keep the column, add an array.** `profiles.roles text[]` holds several roles
but still records no history, and it sits on a row the user can update — which
is exactly the escalation 0036 had to guard against. The guard would have to
grow a second special case for every new role.

**Roles as JWT claims.** Fast to read and impossible to revoke promptly: a
suspended technician keeps their access until the token expires. Revocation
that takes effect on the next request was worth more than saving a join.

**Two apps, shared packages.** Preserves the split at the cost of two installs,
two review queues, and the thing that actually matters: a technician who wants
to see their own car's logbook has to install the other app and sign in as
somebody else.
