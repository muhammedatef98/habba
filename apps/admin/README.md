# لوحة التشغيل — the ops console

A Next.js web app. **It is never bundled into `apps/mobile`, not even behind a
role check** (CLAUDE.md §5.1.6): code behind a role check still ships to every
user's device, where it can be read and probed. A separate bundle is the
boundary; a role check is not.

---

## What it is for

Three things ops can do that nobody else can:

| Surface                  | What it does                                                                    |
| ------------------------ | ------------------------------------------------------------------------------- |
| **Dispatch board**       | Live orders, ordered by trouble rather than by time (0053)                      |
| **Provider review**      | Approve or reject a KYC application — **this is what grants the provider role** |
| **Verification history** | Who vouched for whom, and when (0052)                                           |

⚠️ Until an operator approves an application, nobody in the country holds an
approved `provider` record — so the entire provider side of the mobile app is
unreachable. This console is not an admin nicety; it is the gate every
technician passes through.

---

## The boundary is not in this app

`src/lib/ops-session.ts` decides **what the UI renders**. It is not the security
boundary and must never be treated as one.

The boundary is `is_ops()` (0013), evaluated inside Postgres on every policy and
every ops-only function. Someone who bypasses this console entirely — devtools,
a crafted request, a stale bundle — reaches a database that returns them no
provider rows and accepts no decisions.

What the console adds on top is Amendment B's three requirements, below.

---

## 1. 2FA is mandatory

Not offered — **required**. An operator can approve providers, read every order
and change what everyone is charged; a stolen password must not be enough.

An ops account with **no enrolled factor is refused sign-in** rather than waved
through. An exemption for "the one account that hasn't set it up yet" is how a
mandatory control quietly becomes an optional one.

Sign-in is two steps: password, then a TOTP code. The session is only usable at
`aal2` — a session that stopped at the password is not an operator session,
whatever the role rows say.

**Enrolling a new operator** (done once, by an existing `super_admin`):

1. Create the account in Supabase → Authentication → Users.
2. Grant the role: `select public.grant_user_role('<uuid>', 'ops');`
3. Have them sign in to Supabase Studio once and enrol a TOTP factor
   (Account → Multi-factor authentication). Until they do, this console will
   refuse them with «هذا الحساب بدون تحقّق بخطوتين».

> In development the stub in `ops-session.ts` demands the second factor too —
> email `ops@habba.sa`, any password of 8+ characters, code `000000`. That is
> deliberate: a dev path that signed straight in would leave the 2FA branch of
> the screen unexercised until the first real operator hit it.

## 2. Sessions expire after 8 hours

There is no "remember me". `OPS_SESSION_MAX_SECONDS` is checked on every read
rather than on a timer — a timer does not survive the tab being suspended, and a
console left open overnight must not still be operating in the morning.

⚠️ The client-side check **shortens** the window; it does not close it. A token
still valid at the platform is still valid. Set the project's JWT expiry to
match: Supabase → Authentication → Sessions → **Access token expiry 3600s**,
**Inactivity timeout 8 hours**, **no refresh beyond 8 hours**.

`src/lib/ops-session.test.ts` covers the rule, including the boundary and the
case that matters most: a session whose issue time is unknown counts as
**expired**, not as young. A session we cannot date is one we cannot vouch for.

## 3. Every action writes an audit row

`audit_log` (0070) — `actor_id, action, target_table, target_id,
changed_columns, before, after, ip, at`.

It is a **trigger**, not something each action remembers to write: an audit that
has to be remembered has holes exactly where somebody was in a hurry. The rows
are append-only — no update or delete policy exists for anyone, ops included.

For actions no trigger can see (reading a customer's phone number during a
dispute, exporting a report) call `record_ops_action(...)` explicitly.

⚠️ Only the **changed** columns are recorded. A whole-row snapshot of
`providers` would copy `national_id_encrypted` and `iban_encrypted` into a
second table with different access rules on every edit — an audit log that
quietly becomes a less-guarded copy of the KYC vault.

---

## Running it locally

```bash
pnpm --filter @habba/admin dev     # http://localhost:3100
```

With no `NEXT_PUBLIC_SUPABASE_URL` set it runs on the in-memory ops repository
and the dev auth stub, so the board and the review queue are usable before a
project exists.

Against a real project:

```bash
# apps/admin/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable or anon key>
```

Both are public by design and useless unless RLS is wrong.

⚠️ **`SUPABASE_SERVICE_ROLE_KEY` never appears here.** Not in `.env.local`, not
prefixed `NEXT_PUBLIC_`, not in a client component. The console has no
server-side data path that needs it — every read goes through the operator's own
session, which is what makes `is_ops()` the boundary rather than a wrapper
around a key that bypasses RLS.

`./supabase/scripts/check-secret-exposure.sh` fails CI if that ever stops being
true. It catches a secret read on a client path, a secret renamed under a
`NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefix, a `'use client'` component reading any
non-public env var, and a literal key committed to a source file.

## Deploying to Vercel

**Zero code changes** — the only difference is environment variables
(Amendment B). No hardcoded URLs, no hardcoded keys, no `if (production)`
branches.

1. Import the repo into Vercel and set the root directory to `apps/admin`.
2. Build command `pnpm build`, install command `pnpm install --frozen-lockfile`
   (run from the repo root; the monorepo is pnpm workspaces).
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the
   Vercel project's environment variables. Nothing else.
4. Restrict access at the edge if you can — a Vercel deployment protection rule
   or an IP allowlist. The database refuses a non-operator regardless, but there
   is no reason for the sign-in page to be reachable from the open internet.

**How to tell it worked:** sign in as an operator and the board loads with live
orders. Sign in as a technician and you get «هذا الحساب لا يملك صلاحية الدخول»
— which is the same message a wrong password gets, deliberately: confirming the
credentials were right hands a prober information.
