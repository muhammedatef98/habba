# Habba ops console (`apps/admin`)

The operations dashboard: provider verification queue, board, audit log.
A Next.js **web** app, and only ever one (CLAUDE.md §5.1.6). None of this code
is bundled into `apps/mobile`, so it never reaches a customer's phone.

## Where security actually lives

The console holds **no privileged key**. It talks to Supabase with the public
anon key and the operator's own session, so everything it can do, a hand-crafted
request with that session can do, and nothing more. The boundary is `is_ops()` in
the database (migration `0068`). It is true only when all three of these hold:

1. the user holds an unrevoked `ops` or `super_admin` row in `user_roles`;
2. the session is `aal2`, meaning a second factor (TOTP) was verified in it;
3. that verification was less than **8 hours** ago.

If any condition fails, RLS returns nothing and every ops RPC refuses with
`42501`. The screens in `app/` walk an operator through the same three steps in
order so that they are never shown a control that would fail. They are not the
boundary.

- **2FA is mandatory.** On the first sign-in the operator enrols an authenticator
  app from a QR code. On every sign-in after that, they enter its 6-digit code.
- **Sessions last 8 hours** from the second factor. The server stops honouring
  the session at that point. The console notices and asks for the code again.
- **No "remember me".** The session is stored in `sessionStorage`, so closing
  the tab or browser ends it.
- **Every change an operator makes is recorded** in `audit_log`: who made it,
  the action, the table and row, before and after, IP address and time. The
  record is written by database triggers, not by this app. It is append-only
  for everyone, the table owner and the service role included. KYC ciphertext
  columns (`*_encrypted`) are redacted from it. The log is shown in the
  «سجلّ التدقيق» section.

## Environment variables

| Variable                        | Where   | Value                                    |
| ------------------------------- | ------- | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | browser | `https://<project-ref>.supabase.co`      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | the project's **anon / publishable** key |

That is the whole list. Local development and Vercel differ only in these
values. There are no hardcoded URLs and no `if (production)` branches.

⚠️ **Never** give this app `SUPABASE_SERVICE_ROLE_KEY` or an `sb_secret_…` key,
and never name any variable `NEXT_PUBLIC_…SERVICE…`, `…SECRET…` or
`…PRIVATE…`: Next inlines every `NEXT_PUBLIC_` variable into the JavaScript it
sends to browsers. If a future server route truly needs the service key, it goes
in an unprefixed variable read only from a route handler or server component.

`pnpm admin:check-bundle` enforces this. It builds the app, scans
`.next/static` (the files a browser downloads) for secret keys, service-role
JWTs, the variable names, and the literal value of `SUPABASE_SERVICE_ROLE_KEY`
if one is set. It also fails if any source file declares a secret-looking
`NEXT_PUBLIC_` variable. It runs in CI and in `pnpm verify`.

## Running locally

```bash
pnpm install
pnpm --filter @habba/admin dev        # http://localhost:3100
```

**Without any env vars**, the console runs against in-memory data and a
development sign-in, so every screen can be reached before a project exists:

- email `ops@habba.sa`, any password of 8+ characters;
- authenticator code `123456` (the first sign-in in a tab shows the enrolment
  screen; later ones show the code screen).

**Against a real sign-in**, you need a Supabase Auth server. The repo's
`supabase/scripts/local-db.sh` harness is Postgres + PostgREST only, so use a
Supabase project (a free dev project is enough) and create
`apps/admin/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the project's anon key>
```

Then make someone an operator. There is deliberately no UI for this, so run it in the SQL editor:

```sql
insert into public.user_roles (user_id, role, granted_by)
values ('<auth user id>', 'ops', '<your auth user id>');
```

In the Supabase dashboard, enable **TOTP** under Authentication → Multi-Factor.
The operator signs in with email and password, then enrols their authenticator
on the first visit.

## Deploying to Vercel

1. Import the repository and set **Root Directory** to `apps/admin`. Vercel
   detects Next.js and pnpm workspaces. The workspace packages (`@habba/ui`,
   `@habba/core`, `@habba/i18n`) are compiled by `transpilePackages`, so no
   separate build step is needed.
2. Add the two `NEXT_PUBLIC_…` variables above, for Production and Preview.
   Add nothing else.
3. Deploy. No code changes are needed between local and Vercel.
4. In Supabase → Authentication → URL Configuration, add the Vercel domain to
   the allowed redirect URLs.

## Checks

```bash
pnpm --filter @habba/admin typecheck
pnpm --filter @habba/admin test        # unit tests, including the bundle scanner
pnpm admin:check-bundle                # build + no-secret-in-bundle check
```

The database side (2FA, the 8 hours, the audit log's immutability) is proven in
`supabase/tests/41_ops_two_factor_and_audit.sql`, run by `pnpm db:test`.
