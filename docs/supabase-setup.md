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

| What               | Where                                   | Goes                                  |
| ------------------ | --------------------------------------- | ------------------------------------- |
| Project URL        | Settings → API                          | `EXPO_PUBLIC_SUPABASE_URL` (app)      |
| `anon` public key  | Settings → API                          | `EXPO_PUBLIC_SUPABASE_ANON_KEY` (app) |
| `service_role` key | Settings → API                          | **server only** — never in the app    |
| JWT secret         | Settings → API → JWT Settings           | verification script only              |
| Connection string  | Settings → Database → Connection string | verification script only              |

The `anon` key is designed to be public and ships in the bundle; it is useless
unless RLS is wrong, which is what §6 re-checks. The `service_role` key bypasses
RLS entirely — it belongs in Edge Function secrets and nowhere else, ever
(CLAUDE.md §5.1.6).

## 4. Apply the migrations

From a checkout, with `psql` installed:

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
./supabase/scripts/verify-hosted.sh --migrate-only
```

That applies `0001`–`0043` in order and then the seed (cities, 20 makes and
their models, the service catalogue, maintenance rules). It refuses to run
against a database that already holds vehicles, so it cannot be pointed at
production by accident.

`supabase link && supabase db push` does the same thing if you prefer the CLI;
the script exists because it also runs the checks in §6.

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

Supabase's built-in SMS providers do not include Unifonic, and Unifonic is the
choice because CITC sender-ID registration is the slow part of sending SMS in
Saudi Arabia and a local aggregator does it as part of onboarding.

So delivery goes through a **Send SMS auth hook**:

1. **Deploy the function.**

   ```bash
   supabase link --project-ref <ref>
   supabase functions deploy send-sms-hook --no-verify-jwt
   ```

   `--no-verify-jwt` is right here and only here: GoTrue calls the hook with a
   webhook signature rather than a user JWT, and the function verifies that
   signature itself. Without it, the hook would reject GoTrue.

2. **Set the function's secrets.** Edge Functions → `send-sms-hook` → Secrets,
   or:

   ```bash
   supabase secrets set \
     UNIFONIC_APP_SID='<from the Unifonic console>' \
     UNIFONIC_SENDER_ID='<your CITC-registered sender ID>'
   # UNIFONIC_BASE_URL only if Unifonic gave you a different API host
   ```

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

3. **Register the hook.** Authentication → Hooks → **Send SMS** → enable →
   HTTP → URI `https://<ref>.supabase.co/functions/v1/send-sms-hook`.

4. **Copy the signing secret** the dashboard shows (`v1,whsec_…`) into the
   function's secrets as `SEND_SMS_HOOK_SECRET`. The function refuses to run
   without it — an unsigned endpoint that sends SMS is someone else's bill.

5. **Rate limits.** Authentication → Rate limits → SMS. Set something sane
   (30/hour is a reasonable project-wide ceiling). This is a second layer: the
   per-phone limit the product promises — **5 per number per hour** — is
   enforced in Postgres by migration `0042`, because Edge Functions are
   stateless and a counter in process memory resets on every cold start.

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
export SUPABASE_ANON_KEY='<anon key>'
export SUPABASE_SERVICE_ROLE_KEY='<service role key>'
export SUPABASE_JWT_SECRET='<JWT secret>'
export SUPABASE_DB_URL='postgresql://...'

./supabase/scripts/verify-hosted.sh
```

It creates four test users through GoTrue's admin API, seeds the provider
records, approves one of them through a privileged SQL write, and then runs
`tests/rls.spec.ts` — **the same 17 assertions CI runs locally** — over HTTPS
with minted JWTs.

Expect `Tests 17 passed`. Anything else means the hosted project does not
enforce what the local one does, and the launch stops there.

Afterwards, delete the four test users (Authentication → Users) and their rows
if the project is heading for production.

> The local shim (`supabase_shim.sql`) must **never** be applied to a hosted
> project. It contains `test_grant_role` and `test_approve_provider`, which in
> production would be exactly the privilege escalation that migrations 0036 and
> 0040 exist to prevent. `verify-hosted.sh` does not apply it.

## 7. Deploy the report function

```bash
supabase functions deploy report
supabase secrets set HABBA_PUBLIC_BASE_URL='https://habba.sa'
```

تقرير هبّة is served at `/functions/v1/report/<token>`. Point whatever domain
you use for share links at it, and set `EXPO_PUBLIC_REPORT_BASE_URL` in the app
to match — the QR on the report encodes that URL, so a mismatch produces a code
that scans to nothing.

## 8. Point the app at the project

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
EXPO_PUBLIC_ENABLE_PROVIDER_MODE=false
EXPO_PUBLIC_REPORT_BASE_URL=https://habba.sa/r
```

Restart Metro. With those set, the app switches from the in-memory repository
to Supabase and from the dev OTP to real SMS — the same switch, in one place
(`repository.ts` and `otp.ts`), with no screen changes.

For builds, put the same values in EAS: `eas secret:create --name
EXPO_PUBLIC_SUPABASE_URL --value ...`.

**Leave `EXPO_PUBLIC_ENABLE_PROVIDER_MODE=false`** until the KYC vault is real
and an ops console exists to approve applications (ADR-0017).

## 9. Before real users

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

| Symptom                                                        | Cause                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `PostGIS is installed in schema "public"` on migration 0001    | PostGIS was enabled outside `extensions`. `DROP EXTENSION postgis CASCADE`, redo §2.    |
| `type "extensions.geography" does not exist`                   | Same cause on an older checkout — pull, so 0001 carries the check.                      |
| OTP never arrives, function logs say `delivered`               | Sender ID not registered with the CITC. The operators drop it silently.                 |
| OTP never arrives, function logs say `delivery failed (…)`     | Unifonic rejected it. The code in the log is theirs; no message body is ever logged.    |
| `sms_not_sent` immediately, no function invocation             | The hook is not registered, or `SEND_SMS_HOOK_SECRET` is missing.                       |
| Sign-in works but the app shows six boxes and the SMS has four | OTP length in the dashboard does not match `OTP_LENGTH` (§5).                           |
| `tests/rls.spec.ts` fails hosted but passes locally            | Stop. Do not launch. Compare the failing assertion against `supabase/tests/04_rls.sql`. |
