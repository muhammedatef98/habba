# apps/admin — لوحة العمليات

The ops console. A **separate Next.js web app**, and it stays one: Amendment B
(CLAUDE.md §5.1.6) is explicit that ops functionality is never merged into
`apps/mobile`, not even behind a role check — code behind a role check still
ships to every user's device, where it can be read and probed.

```
app/
  page.tsx      entry: session check, then sign-in or the console shell
  sign-in.tsx   email + password
  board.tsx     the dispatch board (0053)
  audit.tsx     the audit trail (0064)
src/
  data/         ops-repository (Supabase + in-memory), types
  lib/          ops-session (who is operating), theme
```

## Running it

From the repository root:

```bash
pnpm install
pnpm --filter @habba/admin dev     # http://localhost:3100
```

With no project configured it runs on an in-memory repository, the same way
the mobile app does and for the same reason (ADR-0010). Sign in with:

| Field    | Value                   |
| -------- | ----------------------- |
| Email    | `ops@habba.sa`          |
| Password | anything ≥ 8 characters |

Any other address is treated as a real account without the role, so the
console's "not ops" branch is reachable in development rather than only in
production.

## Configuration

Everything environment-specific is an environment variable, so **the same code
runs locally and on Vercel** — Amendment B again: no hardcoded URLs, no
hardcoded keys, no `if (production)` branch anywhere.

```bash
cp .env.example .env.local    # git-ignored
```

| Variable                        | Default | Notes                                            |
| ------------------------------- | ------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | unset   | Unset → in-memory repository and the dev sign-in |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | unset   | Public by design; useless unless RLS is wrong    |

**`SUPABASE_SERVICE_ROLE_KEY` does not appear in this table, and must never
appear in this app.** It is server-only — route handlers and server components
exclusively — never `NEXT_PUBLIC_`, and never imported from a client
component. Everything this console does today goes through the **anon key plus
the operator's own session**, which is the stronger arrangement: the database
refuses a non-ops caller whatever the console believes about them.

## Deploying to Vercel

Import the repository, set the root directory to `apps/admin`, and set the two
variables above. That is the whole difference between local and production —
if a deployment ever needs a code change, something has been hardcoded that
should not have been.

## What it does, and what enforces it

| Screen               | What it is                                                        |
| -------------------- | ----------------------------------------------------------------- |
| اللوحة               | Live orders ordered by trouble, not by time (`ops_active_orders`) |
| مراجعة مقدّمي الخدمة | The verification queue — the action that grants the provider role |
| سجل الإجراءات        | The audit trail: every action, immutable, newest first            |

**The console is not the boundary.** `src/lib/ops-session.ts` decides what the
UI renders; `is_ops()` (0013) decides what the database will answer, on every
policy and every ops-only function. Someone who bypasses the sign-in screen
entirely — devtools, a crafted request, a stale bundle — reaches a database
that returns them no provider rows and accepts no decisions.

Two things in particular are enforced where it counts:

- **A rejection or suspension needs a stated reason.**
  `set_provider_verification` (0052) refuses one without, in the same
  transaction that writes the status, so the status and the reason cannot
  drift apart. The form asks for it first so an operator is told the rule
  rather than discovering it.
- **Every action writes `audit_log`** (§6.10, migration 0064) — actor, action,
  target, the row state either side, and the address the edge reported. The
  table has no UPDATE and no DELETE: the trigger raises, it is `ENABLE ALWAYS`
  so it binds `service_role` too, and there is no write policy or write grant
  for anyone. The only writer is `record_audit()`, which no client role may
  execute.

  The address is **evidence and never proof**, and the screen labels it that
  way every time it appears: `x-forwarded-for` is a client-supplied header.
  The authoritative fact on an audit row is the actor, which came from a
  signed JWT.

## Not built yet

Named here rather than discovered later. All of it is Phase 6 (§9.4) and none
of it is blocked on an open decision:

- **2FA, mandatory, and 8-hour sessions with no "remember me".** Required by
  Amendment B before this is operated for real.
- **The CI check that fails the build** on a client-reachable service-role key.
- Dispute resolution, pricing tuning, payout runs.
- `audit_log` has one writer so far, because the verification queue is so far
  the only action the console takes. The table exists so the next one has
  nowhere else to go.

## Tests

The console's data layer is covered by the SQL suites behind it —
`supabase/tests/28_ops_board.sql`, `27_provider_verification.sql` and
`37_audit_log.sql` — and by nothing that renders these screens. There are no
component tests here yet; `docs/ROADMAP.md` says so in the list of what comes
next rather than leaving it to be found.
