# Manual test script — Phase 1 and Phase 2 acceptance

Proves the two phases' acceptance criteria by hand, plus the Amendment A
role rules. Roughly 20 minutes end to end.

Automated coverage runs first and covers most of this; what a person adds is
seeing RTL, dark mode and the empty states on a real screen, which no assertion
here checks.

```bash
pnpm install
pnpm db:reset && pnpm api:start        # local Postgres + PostgREST
pnpm verify                            # typecheck, lint, unit, SQL suites, integration, RLS
```

`pnpm verify` twice in a row should both be green. One run can pass while
proving less than it looks — see §4 of HANDOFF.md.

---

## A. Phase 1 — Foundation

> **Acceptance:** a user signs up with a Saudi phone number, adds a vehicle,
> sees an empty logbook. RLS passes. The app runs RTL in Arabic and LTR in
> English. (Amendment A adds: they hold exactly one role, and the mode
> switcher is not rendered.)

| #   | Do this                                                            | Expect                                                                                                              |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| A1  | `pnpm --filter @habba/mobile start`, open on a device or simulator | Arabic, right-to-left, from the first frame. Nothing flashes LTR first.                                             |
| A2  | Read the first screen                                              | It asks for a phone number. **No question about being a customer or a technician** — anywhere in the flow (§5.1.1). |
| A3  | Enter `0512345678`                                                 | Accepted and normalised to `+966512345678`.                                                                         |
| A4  | Enter `0412345678`                                                 | Refused in Arabic, naming what is wrong. Saudi mobiles start `05`.                                                  |
| A5  | Send the code, enter `123456`, enter a name                        | Signed in, landing on the vehicle list.                                                                             |
| A6  | Open «حسابي» from the bottom of the home screen                    | «اشتغل معنا كفنّي» is offered. **No mode switcher** — this account holds only `customer` (§5.1.4).                  |
| A7  | Add a vehicle: make → model → year, plate optional                 | Three taps to a saved vehicle. It appears on the home screen.                                                       |
| A8  | Open the vehicle                                                   | The logbook, with one entry: «تم تسجيل السيارة في هبّة», badged **موثّق من هبّة**.                                  |
| A9  | Switch the device language to English and relaunch                 | LTR, English copy, and the layout mirrors — arrows and chevrons flip, the car and wrench icons do not.              |
| A10 | Switch the device to dark mode                                     | A designed dark scheme, not a filter. Badges and body text stay legible.                                            |

**A11 — RLS, from outside the app.** With the harness running:

```bash
HABBA_REQUIRE_HARNESS=1 pnpm test:rls
```

17 assertions, all made over HTTP with a minted JWT rather than through the
app: a stranger cannot read another user's vehicles, timeline or profile even
when naming the row by id; anonymous gets the catalogue and nothing else; the
timeline cannot be written directly by anyone, including the owner.

---

## B. Amendment A — becoming a provider

> **Acceptance:** the upgrade is in-app, the role comes only from approval, and
> a customer-only user can reach no provider surface.

**This section needs `EXPO_PUBLIC_ENABLE_PROVIDER_MODE=true` in
`apps/mobile/.env.local`.** It
ships `false`, so on a default build there is no «اشتغل معنا كفنّي» entry, no
mode switcher, and no reachable KYC form — which is itself worth checking
first:

| #   | Do this                                                   | Expect                                                                       |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| B0a | On a default build, open «حسابي»                          | No «اشتغل معنا كفنّي» card and no mode switcher.                             |
| B0b | Deep link straight to the form: `habba://become-provider` | Redirected to the profile. No field asking for an ID or an IBAN is rendered. |

Then set the variable to `true`, restart Metro, and continue.

| #   | Do this                                                                | Expect                                                                             |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| B1  | «حسابي» → «اشتغل معنا كفنّي»                                           | A KYC form: individual/workshop, business name, city, ID/Iqama, IBAN.              |
| B2  | Enter ID `3012345678`                                                  | Refused — a Saudi ID starts `1`, an Iqama `2`.                                     |
| B3  | Enter IBAN `SA0380000000608010167519` with a digit changed             | Refused by the mod-97 check before anything is sent.                               |
| B4  | Submit with valid values (`1012345678`, a real-format IBAN)            | "We have your application", and it says plainly that applying is **not** approval. |
| B5  | Return to «حسابي»                                                      | Status reads «طلبك قيد الانتظار للمراجعة». **Still no mode switcher.**             |
| B6  | Try to reach the provider surface directly (deep link `habba://shift`) | Redirected to the vehicle list. Nothing provider-shaped renders.                   |

**B7 — approve it the way ops will.** There is no admin app yet (Amendment B,
Phase 6), so approval goes through the harness shim:

```bash
psql -h localhost -p 54329 -d habba_dev \
  -c "select id, business_name_ar, verification_status from public.providers"
psql -h localhost -p 54329 -d habba_dev \
  -c "select public.test_approve_provider('<id from above>')"
```

| #   | Do this                                                                                                   | Expect                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| B8  | Reopen «حسابي» (the roles query refetches; force-quit to be sure)                                         | The mode switcher appears. Same account, same phone number, same vehicles.                    |
| B9  | Switch to provider mode                                                                                   | The shift screen. «انتقل إلى وضع العميل» is one tap away.                                     |
| B10 | Force-quit and reopen                                                                                     | It reopens in provider mode — the last mode is persisted (§5.1.4).                            |
| B11 | Suspend the record: `update providers set verification_status='suspended'` via `begin_privileged_write()` | Provider access is gone on the next request, with no sign-out. The account keeps its logbook. |

**B12 — the account cannot grant itself anything.** Covered by `pnpm test:rls`
(a customer cannot insert into `user_roles`, cannot call `grant_user_role`,
cannot approve its own provider record, and a pending applicant has exactly a
customer's access).

---

## C. Phase 2 — The logbook

> **Acceptance:** an owner records three past services manually, generates a
> report, opens the public link in a browser, and the hash chain verifies.

| #   | Do this                                                                                                                | Expect                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Open the logbook of the vehicle from A7                                                                                | The empty state explains why the logbook is worth filling, and offers a next action.                                                                      |
| C2  | «سجّل صيانة سابقة» — type «تغيير زيت وفلتر», date `2023-04-10`, 42,000 km, 350.00 SAR, part «فلتر زيت» / `90915-YZZE1` | Saved. The notice before you type says it will read as owner-entered.                                                                                     |
| C3  | Add a second entry dated `2024-02-18`, and a third dated `2025-01-05`                                                  | Three entries, **grouped by year**, newest first, each year headed with its count and verified share.                                                     |
| C4  | On one entry, attach a photo before saving                                                                             | The notice changes: with evidence the entry is «مُدخل من المالك مع مرفق», a distinct badge — and the server decides that, not the form.                   |
| C5  | Try a date in the future                                                                                               | Refused in Arabic. (The database refuses it too — the screen is not the only guard.)                                                                      |
| C6  | Tap an entry                                                                                                           | Detail: both dates, the parts and cost, the attachments, and what this provenance level does **not** claim. No edit button — the timeline is append-only. |
| C7  | «العداد والمسافات» → record 61,200 km                                                                                  | Saved, and the progression shows a bar per interval with an average km/day.                                                                               |
| C8  | Try to record 30,000 km                                                                                                | Refused: the odometer only moves forward.                                                                                                                 |
| C9  | «أصدر تقرير هبّة»                                                                                                      | A token and a share link.                                                                                                                                 |

**C10 — the public page.** No app, no login. Against the local harness the
report payload comes from the database:

```bash
psql -h localhost -p 54329 -d habba_dev \
  -c "select public.get_habba_report('<token>')"
```

Deployed, the same token is served as HTML by the `report` Edge Function. On
that page expect:

- Arabic, RTL, mobile-first, and **no owner name, phone or address** — the
  report is about the car (§7.3 privacy rule)
- every entry badged by provenance, and a headline count of how much Habba can
  stand behind
- a verification section stating the chain was checked, with a **QR** — scan it
  with a phone and it opens this same report URL
- Print to PDF: the layout holds, and the QR stays large enough to scan off
  paper

**C11 — the chain actually verifies.**

```bash
psql -h localhost -p 54329 -d habba_dev \
  -c "select * from public.verify_vehicle_timeline('<vehicle-id>')"
```

Returns `is_valid`, `checked_count`, `first_invalid_id`, `reason`. Expect
`is_valid = t` and `checked_count` matching the number of entries.

**C12 — and it detects tampering.** Covered by `supabase/tests/03_tamper.sql`,
which rewrites a row as the table owner and asserts the chain then fails
verification. Run `pnpm db:test` to see it.

---

## D. What this script does not prove

- **Anything about real money, real SMS or real KYC.** OTP is `1234`, payments
  are a dev provider, and KYC values are sealed with a placeholder (ADR-0017).
- **That the read-side audit is complete.** It is a completeness check over
  known tables, not a proof (HANDOFF.md §13).
- **Any provider job flow end to end.** Phase 3's screens exist and the backend
  passes its own suites, but that is not what these two phases claim.
