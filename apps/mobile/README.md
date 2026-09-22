# apps/mobile — هبّة

One Expo app, two audiences. Vehicle owners and providers share an account, a
binary and an install; which surface a user sees is decided by the roles the
**server** says they hold (CLAUDE.md §5.1).

```
app/                      Expo Router routes — thin files, one export each
  index.tsx               phone entry (asks for a number, never a role)
  verify.tsx              OTP
  email.tsx               email sign-in / register
  save-account.tsx        guest → account
  profile.tsx             account, «اشتغل معنا كفنّي», mode switcher
  become-provider.tsx     KYC application
  (customer)/             vehicles, logbook, event, mileage, record-service,
                          emergency, tracking, quote, booking, transfer,
                          accept-transfer, inspection (the report)
  (provider)/             shift, my-jobs, job, evidence,
                          inspection (the form)
src/features/
  customer/               customer-only screens and components
  provider/               provider-only screens and state
  shared/                 data layer, lib, session/mode state, shared screens
```

`customer/**` and `provider/**` **must not import each other**, and `shared/**`
must import neither. ESLint enforces it as an error, so `pnpm lint` — and CI —
fails on a cross-import. If both sides need something, move it to `shared/`
deliberately.

## Running it

From the repository root:

```bash
pnpm install
pnpm --filter @habba/mobile start          # Metro; press i / a, or scan the QR
```

Or from this directory:

```bash
npx expo start                # dev build or simulator
npx expo start --go --tunnel  # Expo Go over a tunnel (works behind a firewall)
npx expo start --ios          # boot the iOS simulator directly
```

**Dev credentials.** With no Supabase project configured the app runs on the
in-memory repository:

| Thing         | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| OTP code      | `123456`                                                          |
| Email auth    | in-memory stub — any address, password ≥ 8 characters             |
| Location      | a fixed Dammam coordinate                                         |
| Camera        | stubbed; "add a photo" records an attachment without a real image |
| Provider role | granted only by approval — `apps/admin`, or the SQL below         |
| Provider mode | **off** — see Feature flags below                                 |

That last row is deliberate: applying through «اشتغل معنا كفنّي» creates a
`pending` record and grants nothing. To exercise provider mode against the local
harness, approve the record the way ops would — through the console
(`pnpm --filter @habba/admin dev`), or directly:

```bash
pnpm db:reset && pnpm api:start
psql -h localhost -p 54329 -d habba_dev \
  -c "select public.test_approve_provider('<provider-id>')"
```

## Configuration

Everything environment-specific comes from environment variables, read by
`app.config.ts` and exposed through `Constants.expoConfig.extra`. Nothing is
hardcoded in `app.json`, which now holds only the app's identity (name, slug,
scheme, bundle ids).

```bash
cp .env.example .env.local   # git-ignored
```

| Variable                           | Default | Notes                                              |
| ---------------------------------- | ------- | -------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`         | unset   | Unset → in-memory repository and the dev OTP       |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`    | unset   | Public by design; useless unless RLS is wrong      |
| `EXPO_PUBLIC_ENABLE_PROVIDER_MODE` | `false` | See below                                          |
| `EXPO_PUBLIC_DEV_APPROVE_PROVIDER` | `false` | Dev only, in-memory only — see the inspection loop |

`EXPO_PUBLIC_*` values are **inlined into the bundle** and readable by anyone
with the app. That is correct for these three and for nothing else: the
service-role key, the Unifonic credentials and the SMS hook secret are set on
the server (Supabase → Edge Functions → Secrets). `docs/supabase-setup.md` is
the full runbook.

## Feature flags

| Flag                               | Default | Effect when off                                                                                                                                                                                                          |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EXPO_PUBLIC_ENABLE_PROVIDER_MODE` | `false` | «اشتغل معنا كفنّي» is not offered, the KYC screen redirects before rendering a field, the mode switcher is hidden even from an approved provider, the `(provider)` group is unreachable, and `applyAsProvider()` throws. |

Off by default for the logbook launch: the KYC vault is still a placeholder
(ADR-0017). Collecting a national ID and an IBAN we cannot yet protect is the
thing the flag prevents. The ops console that approves an application does now
exist — that half of the reason has gone.

To work on the provider side, set it to exactly `true` in `.env.local` and restart Metro. The flag
decides only what renders and what the client will send — a user still holds no
provider role until approval, and RLS refuses every provider read regardless
(§5.1.3).

## Walking the inspection loop (no database needed)

الفحص is the one flow with two actors on the same record: an inspector files a
document and a buyer reads it. Both halves run on the in-memory build.

From the repository root:

```bash
pnpm go          # installs, starts the ops console, then Metro — one command
pnpm demo        # just Metro, with both dev flags on
```

`pnpm go` is the whole thing: the console on 3100 in the background and Metro
in front, with Ctrl-C stopping both. Use `pnpm demo` when the console is
already running or you do not need it.

Either way the flags below are set inline, so there is no `.env.local` to
write:

```bash
EXPO_PUBLIC_ENABLE_PROVIDER_MODE=true    # renders the provider surface at all
EXPO_PUBLIC_DEV_APPROVE_PROVIDER=true    # approves your own application
```

The second exists because approval is an ops action and the dev build is one
process with one account, so without it the inspector's half is unreachable on
a laptop. It is read by the in-memory repository and nowhere else; against a
real project roles come from the server and RLS refuses a client that lies
about its own (§5.1.3). Put them in `.env.local` instead if you would rather
they stuck — restart Metro after changing either.

1. Sign in (OTP `123456`), then **حسابي → اشتغل معنا كفنّي** and submit the
   KYC form. With the dev flag on it comes back approved and the mode switcher
   appears; with it off you get the `pending` screen, which is what a real
   applicant sees.
2. As a customer: **احجز موعد → فحص ما قبل الشراء**. It asks for no car —
   §7.3, the one service where demanding a vehicle would block the exact
   customer it exists to win. Pick a workshop and a slot.
3. Switch to provider mode → **ورديتك → ابدأ الاستقبال**. The booking you just
   made is at the top of the feed.
4. Accept it, advance to «جارٍ العمل», then **تعبئة تقرير الفحص**: 43 items in
   11 sections, a provisional score that moves as you answer, and the missing
   required items named when you try to file. Answer the VIN — anything with
   17 characters and no I, O or Q, e.g. `5HGBH41JXMN109186`.
5. Back on the customer side, open that order from **طلباتي**. The report is
   findings-first, and ends on «هذه سيارتي الآن» — which opens a logbook that
   starts with the inspection instead of empty.

The provisional score is computed by the same mirror the server scores with,
and the parity test asserts the two agree; the number you watch while filling
the form is the number the report carries.

## Pointing it at Supabase

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
`.env.local` and restart Metro. Two things switch at once, in one place each:
the repository (`src/features/shared/data/repository.ts`) moves from in-memory
to Supabase, and OTP (`src/features/shared/lib/otp.ts`) moves from the dev stub
to real SMS. No screen changes.

Creating the project, enabling PostGIS in the right schema, wiring the SMS hook
and re-running the RLS suite against it: `docs/supabase-setup.md`.

## Tests

```bash
pnpm --filter @habba/mobile test           # unit + integration
```

The integration suites under `src/features/shared/data/` talk to the local
harness (Postgres + PostgREST). They **skip** themselves when it is not running,
so a bare `pnpm test` stays fast — set `HABBA_REQUIRE_HARNESS=1` to turn a skip
into a failure, which is what CI does.
