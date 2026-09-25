# Pointing Habba at a hosted Supabase project

Everything you need to do in the Supabase dashboard, in order, with what each
step is for and how to tell it worked. About 45 minutes, most of it waiting for
the project to provision and for a CITC sender ID.

Nothing in this document asks you to paste a key into a file that is versioned.
All configuration reaches the app through environment variables
(`apps/mobile/.env.local`, from `.env.example`), and every server-side secret
lives in the Supabase dashboard.

---

## 0. Before you start — one decision only you can make

**Which region — decided: `eu-central-1` (Frankfurt).** Recorded in ADR-0010 on
2026-09-05. Supabase pins your database, Auth and Storage to one region, chosen
at creation and expensive to change afterwards, so use this one unless you are
deliberately revisiting the decision.

There is **no Saudi region**. Frankfurt was chosen over Mumbai's better latency
because a GDPR-grade regime is the most defensible starting point for a PDPL
transfer assessment.

⚠️ **That assessment is still outstanding.** Picking a region is a data-location
control, not a lawful basis for moving Saudi personal data out of the Kingdom.
The transfer basis, a DPA with Supabase, retention, and how erasure requests
interact with an append-only timeline are all open (ADR-0010). They do not block
a small pilot; they do block scale.

---

## 1. Create the project

**Dashboard → New project.**

| Field             | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Name              | `habba-production` (or `habba-staging` — make a staging one first)      |
| Database password | Generate one. Store it in your password manager; you need it in step 3. |
| Region            | **Frankfurt (`eu-central-1`)** — see §0                                 |
| Plan              | Free is fine to prove this out. Production wants Pro, for PITR backups. |

Wait for "Project is ready" — provisioning takes a couple of minutes.

## 2. Enable PostGIS **in the `extensions` schema**

**Database → Extensions → search `postgis` → enable.**

Supabase installs it into `extensions`, which is what Habba requires: every
geography column and every `SECURITY DEFINER` function schema-qualifies
`extensions.*`, because their `search_path` is empty (ADR-0003).

Migration `0001` checks this and refuses to continue with a message naming the
fix, so a mistake here fails loudly in step 4 rather than as a confusing type
error three migrations later.

## 3. Collect the credentials

**Settings → API** and **Settings → Database**:

| What              | Where                                   | Goes                                         |
| ----------------- | --------------------------------------- | -------------------------------------------- |
| Project URL       | Settings → API                          | `EXPO_PUBLIC_SUPABASE_URL` (app)             |
| Publishable key   | Settings → API Keys                     | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (app) |
| Secret key        | Settings → API Keys                     | **server only** — never in the app           |
| Connection string | Settings → Database → Connection string | verification script only                     |

On a project that has not migrated yet, the legacy `anon` and `service_role`
keys (Settings → API) fill the same two rows and everything here works
unchanged — the app reads `EXPO_PUBLIC_SUPABASE_ANON_KEY` when the publishable
one is absent, and the scripts detect which kind of key they were given.

**No JWT secret.** Nothing in this repo needs it any more: the verification
suite signs its fixtures in through GoTrue and uses the tokens it gets back, so
it works whatever the project signs with. That is deliberate — under the
[JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) system
the legacy secret becomes verify-only and cannot be read back, and a suite that
minted its own tokens would be testing a signing path the app never uses.

The publishable key is designed to be public and ships in the bundle; it is
useless unless RLS is wrong, which is what §6 re-checks. The secret key bypasses
RLS entirely — it belongs in Edge Function secrets and nowhere else, ever
(CLAUDE.md §5.1.6).

⚠️ A secret key is **not** a JWT, so it must travel on the `apikey` header
alone; sent as a bearer token the platform answers `Invalid JWT`. Both Edge
Functions and `verify-hosted.sh` decide this per key, so they are correct
before and after the swap — see `packages/core/src/supabase/api-keys.ts`.

## 4. Apply the migrations

From a checkout, with `psql` installed:

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
./supabase/scripts/verify-hosted.sh --migrate-only
```

That applies every file in `supabase/migrations/` in numeric order — starting
at `0001` — and then the seed (cities, 20 makes and
their models, the service catalogue, maintenance rules). It refuses to run
against a database that already holds vehicles, so it cannot be pointed at
production by accident.

`supabase link && supabase db push` does the same thing if you prefer the CLI;
the script exists because it also runs the checks in §6.

### Re-running: `--reset`

Migrations are forward-only, so a second run against an already-migrated
database stops at the first `create type` with `type "user_role" already
exists`. Start over with:

```bash
./supabase/scripts/verify-hosted.sh --reset
```

That drops and recreates schema `public` and then applies everything again.
**Do not do this by hand in the SQL editor.** `drop schema public cascade` also
removes the schema grants and default privileges Supabase set at project
creation, and re-granting them by hand — `grant all on all tables … to anon` —
produces a database that is both broader than the migrations intend and no
longer a valid test of them: the `revoke` statements in `0010`, `0014`, `0026`,
`0030`, `0037` and `0040` are a defence layer of their own, and a blanket grant
afterwards silently undoes all of them.

Migration `0001` now sets those baseline privileges itself, so a database reset
this way ends up with grants that came only from the migrations. That is the
condition the RLS run in §6 has to be judged under.

**How to tell it worked:** Table editor shows `vehicles`, `vehicle_timeline`,
`user_roles` and about forty others; `select count(*) from cities` returns 10.

## 5. Turn on phone auth

**Authentication → Providers → Phone → enable.**

| Setting       | Value | Why                                                                                                                                                          |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OTP length    | **6** | Must equal `OTP_LENGTH` in `otp-provider.ts`. The verify screen renders that many boxes — four boxes against a six-digit SMS is an app nobody can sign into. |
| OTP expiry    | 120s  | Must equal `OTP_TTL_SECONDS`, which drives the resend countdown.                                                                                             |
| Confirm phone | on    | A number is only an identity once it has been proved.                                                                                                        |

Leave "Enable phone confirmations" on and do **not** enable phone sign-ups with
passwords: Habba's identity is the number plus an OTP.

### 5a. The SMS provider is our Edge Function, not a built-in

Supabase's built-in SMS providers include neither Authentica nor Unifonic.
Both are Saudi gateways, and a Saudi gateway is the point: sender-ID
registration with the CITC is the slow part of sending SMS here, and they
have done it already. **Authentica** is the default. It sends on its own
approved sender and templates, so it works from day one. Unifonic stays
supported. The function uses Authentica whenever its key is present.

Supabase Auth still generates, expires and verifies the code. The gateway only
carries it (`packages/core/src/sms/authentica.ts`).

So delivery goes through a **Send SMS auth hook**:

1. **Deploy the function.**

   ```bash
   supabase link --project-ref <ref>
   supabase functions deploy send-sms-hook --no-verify-jwt
   ```

   `--no-verify-jwt` is right here and only here: GoTrue calls the hook with a
   webhook signature rather than a user JWT, and the function verifies that
   signature itself. Without it, the hook would reject GoTrue.

2. **Register the hook.** Authentication → Hooks → **Send SMS** → enable →
   HTTPS → URI `https://<ref>.supabase.co/functions/v1/send-sms-hook` →
   **Generate secret**. The secret looks like `v1,whsec_…`.

3. **Put the two secrets in Vault** (SQL editor), rather than in chat or a file:

   ```sql
   select vault.create_secret('<the v1,whsec_… secret from step 2>', 'send_sms_hook_secret');
   select vault.create_secret('<Authentica → API Keys>', 'authentica_api_key');
   ```

   The function reads them through `edge_provider_secret()` (0088). Only the
   service key can call it, and only for these two names. It reads them on
   every request, so no redeploy is needed. To replace one later, use
   `vault.update_secret(id, '<new>')`. The function's own secrets
   (`SEND_SMS_HOOK_SECRET`, `AUTHENTICA_API_KEY`) still work, and win when set.

   Optional function secrets:
   - `AUTHENTICA_TEMPLATE_ID`: the Authentica template to send on. The default is 1.
   - `AUTHENTICA_SENDER_NAME`: once Authentica approves a sender name for you,
     setting it switches to `send-sms` with Habba's own wording
     («رمز الدخول إلى هبّة: …»).
   - Unifonic instead of Authentica: `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID`,
     and optionally `UNIFONIC_BASE_URL`, with no Authentica key set.

   `SUPABASE_URL` is injected automatically, along with the keys: legacy
   projects get `SUPABASE_SERVICE_ROLE_KEY`, migrated ones also get
   `SUPABASE_SECRET_KEYS` (a JSON object of name → key). The functions prefer
   the latter, so disabling the legacy key needs no redeploy.

4. **Prove it once.** Sign in from the app with a staff phone. The code that
   arrives must be the one the app accepts. If Authentica sends a code of its
   own, the template ignores `otp`: pick another template, or use a sender
   name. The function refuses to run without the hook secret. An unsigned
   endpoint that sends SMS is someone else's bill.

5. **Rate limits.** Authentication → Rate limits → SMS. Set something sane
   (30/hour is a reasonable project-wide ceiling). This is a second layer: the
   per-phone limit the product promises — **5 per number per hour** — is
   enforced in Postgres by migration `0042`, because Edge Functions are
   stateless and a counter in process memory resets on every cold start.

### 5c. Email OTP — the second way in, and the one that does not wait

Phone stays primary (§9.1), but a CITC sender ID takes weeks and email takes an
afternoon. Email OTP is what lets the app reach real users in the meantime, and
it is worth setting up even once SMS works: some people simply prefer it, and
an account between SIMs still needs a way in.

1. **Authentication → Providers → Email → enable.** Leave "Confirm email" on.

2. **Set the OTP expiry.** Authentication → Providers → Email → Email OTP
   Expiration. Must equal `EMAIL_OTP_TTL_SECONDS` in `email-otp-provider.ts`
   (3600s). Deliberately longer than the SMS code's 120s: an email sits in an
   inbox the user may not have open, and a two-minute code turns an ordinary
   delay into a failed sign-in.

3. **Make the message carry a CODE, not a link.** This is the step everyone
   misses. Supabase sends a Magic Link by default, and `signInWithOtp` is the
   same endpoint for both — the difference is the template. Authentication →
   Email Templates → **Magic Link**, and include the token:

   ```html
   <h2>رمز الدخول إلى هبّة</h2>
   <p>الرمز: {{ .Token }}</p>
   <p>صالح لمدة ساعة. إذا لم تطلبه، تجاهل هذه الرسالة.</p>
   ```

   Without `{{ .Token }}` the user receives a link, the app asks for six digits,
   and there is nothing to type.

4. **Configure SMTP.** The built-in sender is rate-limited to a handful of
   messages an hour and is for development only — it will not carry a launch.
   Project Settings → Authentication → SMTP Settings, pointed at Resend (or any
   provider); you need a verified sending domain, which is the slow part and is
   still hours rather than weeks.

5. **Rate limits.** Authentication → Rate limits → Email. Note the asymmetry,
   which is deliberate and recorded in ADR-0020: the per-number limit the
   product promises for SMS (5/hour) is enforced in Postgres by migration
   `0042`, because Edge Functions are stateless. **Email has no per-address
   equivalent** — its limiting is Supabase's, project-wide. Closing that gap
   needs a Send Email hook and a generalisation of 0042's ledger; it is written
   down in the ADR rather than half-built.

**How to tell it worked:** in the app, «الدخول بالبريد الإلكتروني» → an
address → a six-digit code arrives → typing it signs you in, and
`select email, email_verified from profiles` shows `t`. That flag is derived
from `auth.users.email_confirmed_at` by migration `0044` — nothing else in the
system can set it, including a fixture.

### 5b. Before real SMS will actually arrive

- A **Unifonic account** with credit, and an **AppSid**.
- A **sender ID registered with the CITC**. Unregistered sender IDs are dropped
  by the Saudi operators silently — the API reports success and nothing
  arrives. Registration takes days to weeks; start it early.
- Confirm the **API host and field names** against your own Unifonic
  documentation. `packages/core/src/sms/unifonic.ts` targets the REST messaging
  endpoint, and the base URL is configuration for exactly this reason. A
  mismatch fails on the first send rather than silently, by design.

## 6. Verify RLS behaves the same hosted as locally

This is the step that matters. The local harness fakes `auth.users`,
`auth.uid()` and the `anon`/`authenticated`/`service_role` roles; a hosted
project has the real ones, plus a gateway in front of PostgREST. Any of those
could change the answer, and the answer is "can a stranger read this user's
logbook".

```bash
export SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_ANON_KEY='<publishable or anon key>'
export SUPABASE_SERVICE_ROLE_KEY='<secret or service_role key>'
export SUPABASE_DB_URL='postgresql://...'

./supabase/scripts/verify-hosted.sh
```

It creates four test users through GoTrue's admin API — each with a phone, an
email and a password generated for this run — seeds the provider records,
approves one of them through a privileged SQL write, and then runs
`tests/rls.spec.ts` — **the same 17 assertions CI runs locally** — over HTTPS,
holding real GoTrue sessions obtained by signing those fixtures in.

Email sign-in must be enabled on the project (it is by default). The fixtures
carry a phone as their product identity and an email only so the sign-in does
not depend on the phone provider being configured.

Expect `Tests 17 passed`. Anything else means the hosted project does not
enforce what the local one does, and the launch stops there.

Afterwards, delete the four test users (Authentication → Users) and their rows
if the project is heading for production.

> The local shim (`supabase_shim.sql`) must **never** be applied to a hosted
> project. It contains `test_grant_role` and `test_approve_provider`, which in
> production would be exactly the privilege escalation that migrations 0036 and
> 0040 exist to prevent. `verify-hosted.sh` does not apply it.

## 7. Apply the storage policies (dashboard SQL editor)

Migration `0048` creates the private `triage-media` bucket. It deliberately
does **not** create the RLS policies on it, and cannot:

```
ERROR: must be owner of table objects
```

`storage.objects` is owned by `supabase_storage_admin`. `create policy` needs
ownership of the table it is on, and the project's `postgres` role — the one
`psql` and `verify-hosted.sh` connect as — is neither the owner nor a member of
the owning role. This is the same shape as PostGIS in §2: a privileged one-off
that a migration cannot perform.

Migration `0064` does the same for the private `completion-media` bucket,
where technicians upload before/after photos. **Dashboard → SQL Editor**,
paste and run each once, after the migrations:

```
supabase/storage/triage-media-policies.sql
supabase/storage/completion-media-policies.sql
```

**How to tell it worked:** §6's run prints `storage policies for triage-media
are in place` and `storage policies for completion-media are in place`. Until
then it prints a warning naming this step. The failure mode of forgetting is a
closed bucket, never an open one — but for completion-media a closed bucket
means no technician can hand a job back, because `record_completion_evidence()`
refuses any photo that was not uploaded there.

> The local harness applies the same file as the storage owner
> (`local-db.sh`), so `supabase/tests/24_triage_media_storage.sql` exercises
> the real policies rather than a weaker stand-in. Suite `31` asserts the
> harness has not quietly given itself ownership it would not have here.

**Size and type limits** are set by migration 0085 on a hosted project:
`triage-media` takes `video/mp4` and `video/quicktime` up to 50 MB,
`completion-media` takes images up to 10 MB. Check them under Storage →
the bucket → Edit; if the migration ran before the buckets had those columns,
set the same values there.

## 7a. Deploy and schedule the two ticking functions

Two Edge Functions run on their own, and **neither does anything until it is
scheduled**. Without `dispatch-tick` an emergency nobody accepts is never
widened past the first radius, and a job whose customer never confirms it
stays open forever with the payment held; without `push-tick` nobody is ever notified —
not the technician about a new job, not the customer that help has arrived.

| Function        | What it does                                                                                                 | How often                                |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `dispatch-tick` | widens searches nobody has accepted (0051); reminds, then closes, orders the customer never confirmed (0071) | every 15 seconds                         |
| `push-tick`     | delivers `notification_outbox` through Expo Push (0066)                                                      | on every insert (webhook) + every minute |

**Deploy and set their secrets** (each secret a long random string):

```bash
supabase functions deploy dispatch-tick --no-verify-jwt
supabase functions deploy push-tick --no-verify-jwt
supabase secrets set HABBA_DISPATCH_TICK_SECRET=… HABBA_PUSH_TICK_SECRET=…
# Once "enhanced push security" is on for the Expo project (it should be before launch):
supabase secrets set EXPO_ACCESS_TOKEN=…
```

**Or keep the secrets in Vault only (0087).** When a function's environment
variable is unset, it reads the secret from Vault with its own service key
(`edge_tick_secret()`, callable by `service_role` only). Create the Vault
secrets below and skip `supabase secrets set` for the tick secrets entirely —
one copy, set from SQL.

`--no-verify-jwt` because the caller is the scheduler, not a user; the shared
secret in the `x-habba-tick` header is the gate, and a missing or wrong one
gets a 404.

**Schedule them** from the SQL editor, with the secrets in Vault rather than
in the job text (anyone who can read `cron.job` can read the command):

```sql
select vault.create_secret('<HABBA_DISPATCH_TICK_SECRET>', 'dispatch_tick_secret');
select vault.create_secret('<HABBA_PUSH_TICK_SECRET>', 'push_tick_secret');

select cron.schedule('habba-dispatch-tick', '15 seconds', $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/dispatch-tick',
    headers := jsonb_build_object('x-habba-tick',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_tick_secret')),
    body    := '{}'::jsonb);
$$);

select cron.schedule('habba-push-tick', '1 minute', $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/push-tick',
    headers := jsonb_build_object('x-habba-tick',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'push_tick_secret')),
    body    := '{}'::jsonb);
$$);
```

**Make push immediate.** A minute is fine for a retry and far too slow for a
job offer, which is decided in seconds. Dashboard → Database → Webhooks → new
webhook on `notification_outbox`, event **INSERT**, type **Supabase Edge
Function** `push-tick`, with the header `x-habba-tick` set to the push secret.
The schedule stays as the safety net: claims are leased (0066), so the webhook
and the schedule never send the same notification twice.

**How to tell it worked:** go online as a technician on a real phone, create
an emergency near them from a second account, and the phone should buzz
within a couple of seconds. If it does not,
`select kind, attempts, last_error, abandoned_at from notification_outbox order by created_at desc limit 5`
says why — `no_device` means the phone never registered (see §9, the EAS
project id), `expired` means nothing called `push-tick` in time.

### 7b. The payments function (only when payments go live)

`payments` (0077) verifies a Moyasar authorisation with the secret key and
carries out queued captures, voids and refunds. It is off the payment path
until the `payments_gateway` setting says `moyasar`; deploy it before that.

```bash
supabase functions deploy payments          # JWT verified: customers call it
supabase secrets set MOYASAR_SECRET_KEY=sk_live_… HABBA_PAYMENTS_TICK_SECRET=…
```

```sql
select vault.create_secret('<HABBA_PAYMENTS_TICK_SECRET>', 'payments_tick_secret');

select cron.schedule('habba-payments-tick', '30 seconds', $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/payments',
    headers := jsonb_build_object('x-habba-tick',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'payments_tick_secret')),
    body    := '{"action":"tick"}'::jsonb);
$$);
```

`docs/GO-LIVE.md` has the full switch-over, app side included.

## 8. There is no report function to deploy

تقرير هبّة used to be an Edge Function serving a public page at
`/functions/v1/report/<token>`. **ADR-0019 dropped it.** The report is now
generated on the device as a PDF and shared as a file, so there is no endpoint
to deploy, no domain to register and no `HABBA_PUBLIC_BASE_URL` to set.

`generate_habba_report()` and the token still exist, unchanged: the payload is
issued and frozen exactly as before, and the app reads it back by token to
render the document. ADR-0019 lists the steps to bring the public page back if
that decision is reversed.

## 9. Point the app at the project

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
EXPO_PUBLIC_ENABLE_PROVIDER_MODE=false
EAS_PROJECT_ID=<from `eas init`, or expo.dev → project → ID>
```

`EAS_PROJECT_ID` is what a phone needs to get a push token at all. Without it
the app still works, and registers for nothing — every notification then
settles as `no_device` (§7a).

Restart Metro. With those set, the app switches from the in-memory repository
to Supabase and from the dev OTP to real SMS — the same switch, in one place
(`repository.ts` and `otp.ts`), with no screen changes.

For builds, put the same values in EAS: `eas secret:create --name
EXPO_PUBLIC_SUPABASE_URL --value ...`.

**Leave `EXPO_PUBLIC_ENABLE_PROVIDER_MODE=false`** until the KYC vault is real
and an ops console exists to approve applications (ADR-0017).

## 10. Before real users

- **Backups.** Free plan keeps daily backups for 7 days. Production wants Pro
  and PITR. The logbook is the product; losing a week of it is losing the moat.
- **A staging project.** The same steps, a second time. Migrations are
  forward-only and the timeline is append-only, so "try it in production" has no
  undo.
- **Auth emails.** Not used by phone sign-in, but Supabase's defaults are
  English and branded Supabase. Fix them before an email path exists.
- **Delete the verification fixtures** from §6 if this project is production.
- **PDPL.** §0's region choice is necessary and not sufficient: retention,
  erasure requests and the append-only timeline interact (ADR-0010 has the
  detail).

---

## Troubleshooting

| Symptom                                                        | Cause                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PostGIS is installed in schema "public"` on migration 0001    | PostGIS was enabled outside `extensions`. `DROP EXTENSION postgis CASCADE`, redo §2.                        |
| `type "extensions.geography" does not exist`                   | Same cause on an older checkout — pull, so 0001 carries the check.                                          |
| OTP never arrives, function logs say `delivered`               | Sender ID not registered with the CITC. The operators drop it silently.                                     |
| OTP never arrives, function logs say `delivery failed (…)`     | Unifonic rejected it. The code in the log is theirs; no message body is ever logged.                        |
| `sms_not_sent` immediately, no function invocation             | The hook is not registered, or `SEND_SMS_HOOK_SECRET` is missing.                                           |
| Sign-in works but the app shows six boxes and the SMS has four | OTP length in the dashboard does not match `OTP_LENGTH` (§5).                                               |
| `type "user_role" already exists` on migration 0002            | The database has been migrated before. Re-run with `--reset` (§4).                                          |
| `Invalid path specified in request URL` on every write         | `HABBA_POSTGREST_URL` carries `/rest/v1`. It must be the project origin — supabase-js appends the prefix.   |
| `RLS API unreachable … HTTP 401 … No API key found`            | The anon key is missing or belongs to another project. The suite now prints the status and body; read them. |
| `RLS API unreachable … HTTP 403` or `42501 permission denied`  | Schema `public` was reset by hand without its grants. Re-run with `--reset` (§4).                           |
| `tests/rls.spec.ts` fails hosted but passes locally            | Stop. Do not launch. Compare the failing assertion against `supabase/tests/04_rls.sql`.                     |
