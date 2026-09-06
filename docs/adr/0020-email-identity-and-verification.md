# ADR-0020 — Email as a second way in, and what "verified" means

- **Status:** Accepted
- **Date:** 2026-09-06
- **Relates to:** migration 0039 (guest and email identity), 0037 (read-surface
  hardening), build prompt §9.1, §1.3

## Context

Two problems, one answer.

**The launch is blocked on a queue.** Phone OTP needs a CITC-registered sender
ID. Registration takes days to weeks of calendar time and nothing in the
codebase can shorten it (open decision 4). Meanwhile 0039 had already done the
hard part of admitting a second identity: `profiles.phone` became nullable,
`email_verified` and a case-insensitive unique index appeared, and
`profiles_has_identity` was written to accept an account with an email and no
phone. What was missing was a way to actually sign in with one.

**`phone_verified` was a flag nobody set.** It has existed since 0005, and a
grep over the whole repository finds exactly one kind of `= true`: test
fixtures, inserted as the table owner. 0037 then hardened ownership-transfer
discovery to require it — correctly, because `profiles.phone` is self-service
and matching on the value alone would hand an attacker a victim's pending
transfer, `otp_code_hash` included. The hardening worked. What nobody noticed
is that it closed the door on **everyone**: with the flag permanently false, no
recipient could ever discover a transfer addressed to them, and the buyer →
owner conversion — §1.3's zero-CAC acquisition channel — has been dead since
0037 shipped. ADR-0019 has already cost that channel its other half.

## Decision

### 1. Email signs in by one-time code, not by password

`signInWithOtp({ email })` then `verifyOtp({ email, token, type: 'email' })`.
Delivery is Supabase Auth's own, through a custom SMTP sender; the Magic Link
template renders `{{ .Token }}` so the message carries a six-digit code rather
than a link.

The password provider that previously stood here is deleted. A password is a
second secret to invent, store and lose, on an account whose other route in is
a six-digit code — and it drags a reset flow behind it, which is a second
delivery path to build and a second one to attack. A code to the address _is_
the proof of the address, which is the only thing email is being asked for.

There is no separate "register": an address that has never signed in becomes an
account when its code comes back, exactly as a phone number does.

**No Edge Function.** `send-sms-hook` exists because Supabase has no Unifonic
integration and CITC registration made an aggregator unavoidable. Email has no
such gap — SMTP is a dashboard field. Writing a `send-email-hook` to mirror the
SMS one would be symmetry for its own sake.

The cost of that choice, stated so it is not discovered later: the per-identity
limit the product promises for SMS (**5 per number per hour**, enforced in
Postgres by 0042 because Edge Functions are stateless) has **no email
equivalent**. Email rate limiting is Supabase's, configured project-wide in the
dashboard. If per-address parity is wanted, it needs a Send Email hook and a
generalisation of 0042's ledger from `phone` to an identity column — a known
piece of work, deliberately not done now.

### 2. Verified means GoTrue confirmed it, and the value has not changed since

Migration 0044 derives both flags from `auth.users`:

```
profiles.phone_verified  ⇔  auth.users.phone_confirmed_at is not null
                            AND profiles.phone = auth.users.phone

profiles.email_verified  ⇔  auth.users.email_confirmed_at is not null
                            AND lower(profiles.email) = lower(auth.users.email)
```

GoTrue stamps those timestamps when it has actually delivered a code to that
address and seen it typed back. It is the one fact about an identity that the
person holding it cannot assert.

**The second clause is the security property.** Without it, a user whose own
number is confirmed could type a victim's number into their profile and carry
the verified flag across with it — precisely the escalation 0037 was written to
stop. 0039's column guard already knocks the flag down whenever the value
changes; 0044 only ever raises it again when the new value is one GoTrue
vouched for. Both directions are asserted in `23_verified_identity.sql`.

Two triggers keep it true: one on `auth.users` (GoTrue confirms), one on
`profiles` (the row appears after sign-in, or the user corrects their address).
Both are `ENABLE ALWAYS`, so a restore or a replica cannot let the flags drift
from the identities they describe. Neither is callable by a client.

So, for an email-only account: **verified means Supabase Auth delivered a code
to that address and the person typed it back, and the address on the profile is
still that address.** Identical in kind to the phone rule — not a weaker
substitute for it, and not something the account can claim about itself.

### 3. A transfer can be addressed to either identity

Migration 0045 adds `ownership_transfers.to_email`, makes `to_phone` nullable,
and requires exactly one of the two. Discovery matches a _verified_ identity of
either kind.

Acceptance changed too, and this is a genuine tightening rather than a port:
`accept_ownership_transfer` previously checked the OTP and nothing else, so
knowing the id and the code was the whole proof. It now also requires that the
caller holds the identity the transfer was addressed to — the OTP stays as a
second factor. The refusal is deliberately worded identically to a wrong code,
because distinguishing them tells a stranger holding a forwarded link that the
transfer exists and who it is for.

## Consequences

- **The launch stops waiting on the CITC.** Phone stays primary and default;
  email is reachable from a secondary button, as §9.1 intends. Nothing about
  the phone path changes.
- **The buyer → owner channel works again**, for the first time since 0037, and
  now reaches buyers who have no Habba account and no Saudi SIM.
- **Email is cheaper to mint than a Saudi SIM.** An attacker can create more
  accounts more easily than before. What that buys them is a logbook of their
  own self-reported entries — provenance (ADR-0005) already says the system
  vouches for none of it. Nothing that costs money or grants a role is reachable
  by holding an email address: provider approval is ops-only (0052), payments
  are Phase 3.
- **`+`-addressing defeats the unique index.** `ahmed+1@example.com` and
  `ahmed@example.com` are one mailbox and two accounts. Gmail-style
  canonicalisation is deliberately NOT done: the rule differs per provider,
  guessing it wrong merges two real people into one account, and the failure is
  silent. Revisit if abuse actually appears.
- **Test fixtures can no longer assert verification.** `17_read_surface_audit`
  used to insert `phone_verified => true`; the trigger now recomputes it to
  false and the test failed until the fixture seeded a confirmed `auth.users`
  row instead. That is the property working, and it is why the fixture change
  is part of this migration rather than a tidy-up.
- **Anyone who signed in before 0044** is backfilled by the migration; without
  it they would stay unverified until they happened to change something.

## Alternatives considered

- **A `send-email-hook` Edge Function mirroring `send-sms-hook`**, giving email
  the same per-address ledger. Rejected for now: it exists to solve a problem
  email does not have, and it would be the third delivery path to keep alive
  before there is a first user. The generalisation is written down above so
  that adding it later is an afternoon, not a rediscovery.
- **Keeping email + password alongside email OTP.** Rejected: two ways in on
  one identity, one of which needs a reset flow nobody has built, and a
  sign-in screen that has to ask the user which kind of account they have.
- **Trusting `profiles.phone` without the verified flag**, i.e. reverting
  0037's hardening to make transfers work again. Rejected outright: that is the
  vulnerability 0037 was written to close, and it hands over an `otp_code_hash`.
