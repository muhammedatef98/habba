# نقل الملكية — the ownership-transfer flow

Nine phone screens, Arabic RTL, light and dark. Design only — no components
have been written against this yet.

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

| # | Artboard   | What it settles |
| - | ---------- | --------------- |
| 1 | `Main`     | Where «نقل الملكية» lives in the logbook |
| 2 | `Warning`  | What the seller is about to give up |
| 3 | `Address`  | Phone or email, and what is shown before confirming |
| 4 | `Code`     | The handover code, shown once |
| 5 | `Pending`  | The seller waiting, and cancelling |
| 6 | `Accept`   | The recipient who already has an account |
| 7 | `Welcome`  | The recipient who does not — the acquisition moment |
| 8 | `Handover` | The seller afterwards: kept and lost, stated |
| 9 | `Years`    | The logbook grouped by year (parked separately) |

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

## Two gaps this design does not paper over

Both are drawn honestly in the screens rather than assumed away, and both are
decisions for the owner rather than for the renderer.

### 1. There is no `initiate_ownership_transfer()`

Creation today is a plain client `INSERT` under `ownership_transfers_insert`
(`0013`). That means the **client** chooses `otp_code_hash` and `expires_at`,
which is flatly against §2 — "all business logic lives in Postgres functions or
Edge Functions" — and there is nothing to deliver the code.

Screens 3 and 4 are drawn against the function that should exist: it takes the
vehicle and one identity, mints a six-digit code server-side, stores the hash,
sets the expiry, and returns the plaintext exactly once.

The 7-day expiry shown on screen 3 is a proposal. Nothing in the schema sets a
default.

### 2. The warranty does not transfer

`claim_warranty` (`0025`) checks `orders.customer_id`, which is the person who
paid for the work — not the owner of the car. After a transfer:

- the buyer sees «ساري» in تقرير هبّة for cover they cannot claim;
- the seller keeps a claim on a car they no longer own.

Screens 2 and 8 state this in Arabic rather than let a buyer discover it at the
counter. Making warranties follow the car instead is a schema change and its
own decision.

## Open, smaller

- The seller's «إلغاء النقل» has no confirmation step in this draft.
- Nothing here covers a transfer that expires unaccepted — the seller sees the
  countdown, but not what the screen becomes when it reaches zero.
