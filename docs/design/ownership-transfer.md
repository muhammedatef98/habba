# نقل الملكية — the ownership-transfer flow

Nine phone screens, Arabic RTL, light and dark. **Built** — the screens live in
`apps/mobile/src/features/customer/screens/transfer.tsx` and
`accept-transfer.tsx`, against migrations 0054 and 0055.

**Canvas:** https://claude.ai/code/artifact/773103d8-ceb4-43c7-a009-4f7a51ea25fa
**Source:** `docs/design/ownership-transfer/build.py` renders every artboard
twice, light and dark, from one description per screen. The seeded canvas is
build output and is gitignored — re-run the script and re-seed to change it.

Values are lifted from `packages/ui/src/tokens.ts`, not approximated: IBM Plex
Sans Arabic on the 12/14/16/20/24/32/40 ramp at the 1.7 Arabic line-height,
`radius.lg` 16, 56dp primary and 48dp secondary controls, and the real petrol
and sand semantic tokens for each theme.

## Why this exists

§1.3 makes the buyer → owner handover a zero-CAC acquisition channel: the new
owner receives the logbook and becomes a Habba account without anyone paying
for them. That channel has now been closed twice.

- **ADR-0019** removed the public report page, so a buyer can no longer meet
  Habba by opening a link.
- **0037** hardened transfer discovery to require `phone_verified`, which
  nothing set — closing the door on everyone, for three migrations, unnoticed.

`0044` made the flag mean something and `0045` reopened discovery to either
identity. The database is complete and hosted-verified. **No screen reaches
it**, which is what this design is for.

## The screens

| #   | Artboard   | What it settles                                     |
| --- | ---------- | --------------------------------------------------- |
| 1   | `Main`     | Where «نقل الملكية» lives in the logbook            |
| 2   | `Warning`  | What the seller is about to give up                 |
| 3   | `Address`  | Phone or email, and what is shown before confirming |
| 4   | `Code`     | The handover code, shown once                       |
| 5   | `Pending`  | The seller waiting, and cancelling                  |
| 6   | `Accept`   | The recipient who already has an account            |
| 7   | `Welcome`  | The recipient who does not — the acquisition moment |
| 8   | `Handover` | The seller afterwards: kept and lost, stated        |
| 9   | `Years`    | The logbook grouped by year (parked separately)     |

## Decisions

**The entry point sits at the foot of the logbook**, in an «إدارة السيارة»
section beside «تحديث قراءة العدّاد» — not in the coverage card. Transferring
is rare and irreversible; the card holds «أصدر تقرير هبّة», which is the button
people press often. Putting them adjacent optimises for the wrong one.

**The code is read aloud, not delivered.** The server mints it, returns it to
the seller once, and stores only the hash. The seller reads it to the buyer at
handover. This needs no SMS, so the flow does not wait on a CITC sender ID, and
it fits what the OTP now is after `0045`: a second factor on top of "you hold
the addressed identity, and GoTrue confirmed it."

**The PDF offer belongs on the warning screen.** After acceptance the seller
can no longer generate a report for that car, so offering the export
afterwards would be offering it too late.

**Screen 7 leads with the logbook's weight** — how many records, how many
Habba-verified, how far back — before it asks for anything. A stranger deciding
whether Habba is worth an account is the whole point of the screen; a code
field first spends that moment on paperwork.

**Discovery requires a verified identity, so the addressing screen says so.**
`0045` matches on `phone_verified` / `email_verified`. A seller who types a
number the buyer has never confirmed would otherwise watch the transfer vanish
with no explanation.

**Year grouping nests the existing month grouping** rather than replacing it.
`LogbookTimeline` already groups by month; the year band sits above it, and the
filters and `CoverageBar` stay where they are.

## The two gaps, closed

Both were drawn honestly in the screens rather than assumed away, and both are
now fixed in the database rather than documented around.

### 1. `initiate_ownership_transfer()` exists (0054)

Creation used to be a plain client `INSERT` under `ownership_transfers_insert`
(`0013`), so the **client** chose `otp_code_hash` and `expires_at` — flatly
against §2 — and nothing delivered the code.

The function mints six digits server-side, stores the hash, sets the expiry from
`ownership_transfer_window()` (seven days), and returns the plaintext exactly
once. Alongside it: `cancel_ownership_transfer`, `expire_ownership_transfers`,
and `pending_ownership_transfer_for_me`, which is screen 7's whole payload.

Three things fell out of building it, each a defect on its own:

- **`otp_code_hash` was readable by the recipient.** Discovery deliberately
  shows the row to the identity it is addressed to; six digits behind sha256 is
  an offline search of a million candidates, so every recipient could derive the
  code they were supposed to be told. The OTP checked nothing against the one
  party it exists to check. The column is now off the client-readable surface.
- **Expiry was written and never read.** A row sat `pending` forever, and
  because the unique index is partial on `status = 'pending'`, that stale row
  locked the car out of ever being transferred again.
- **The table had no write guard.** It has one now, `ENABLE ALWAYS`: writing a
  transfer row directly is the same thing as taking a car.

### 2. The warranty follows the car (0055, ADR-0021)

`claim_warranty` authorised on `orders.customer_id` — who paid — while
`generate_habba_report` printed cover on the car with no reference to who paid.
Nothing could complete a transfer, so they never disagreed. Now the right to
claim belongs to the current owner; the claim order is created in the
claimant's name and does not inherit the seller's address; and the buyer's read
surface is `vehicle_warranties()` rather than an `orders` policy that would have
handed them amounts, problem descriptions and where the seller lives.

An in-flight claim refuses the transfer — checked at initiation where it is
actionable, and again inside acceptance. ADR-0021 has the reasoning, including
what the seller keeps (their orders and invoices) and what they lose.

## The smaller ones, also closed

- «إلغاء النقل» asks first, in a bottom sheet. The code is already in the
  buyer's hands and cancelling invalidates it.
- Screen 5 has an expired state. Both repositories return a lapsed transfer
  rather than dropping it, so the seller is told the seven days ran out instead
  of being shown a fresh warning screen.

### 3. Expiry runs, and the code cannot be guessed (0056)

Two of the three defects above were fixed in halves, and 0056 closes them.

- **Expiry now has three chances.** 0054 expired on initiation only, so a
  lapsed row stayed `pending` in the table and the only thing keeping it from
  being _accepted_ was a `where` clause in a read. Acceptance now retires it
  too, and a pg_cron sweep runs quarter-hourly where the project has the
  extension — attempted and announced by the migration, never assumed.
- **Five wrong codes lock a transfer, terminally.** Hiding `otp_code_hash`
  closed the offline search; six digits with unlimited attempts through the
  accept endpoint is still a few hours of HTTP. There is a second, per-caller
  limit behind it, because four guesses each on a thousand cars would otherwise
  cost nothing. Neither counter is readable by anyone, and a locked transfer is
  refused exactly the way a wrong code is.

One consequence reaches these screens without changing them: every refusal from
acceptance now arrives as the same `Error('Incorrect code')`, so screen 8's
«انتهت صلاحية الطلب» branch is no longer reachable from a failed accept. It
still fires when the incoming transfer is gone. ADR-0021's amendment has the
reasoning, including why a refusal stopped being an exception.
