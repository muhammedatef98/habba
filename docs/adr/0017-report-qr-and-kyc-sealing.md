# ADR-0017 — An in-page QR for تقرير هبّة, and the KYC sealing seam

- **Status:** Accepted (QR implemented); KYC sealing is a **stub pending ADR-0010**
- **Date:** 2026-09-04
- **Relates to:** ADR-0005, ADR-0010, build prompt §7.3, §11

Two Phase 2 decisions that both come down to "what may leave the page, and what
may leave the device".

## 1. The verification QR is generated in-page

### Context

تقرير هبّة is read by a buyer standing next to a car, often from a printed
page. On paper the QR is the only route back to the live report — the thing
that makes the report verifiable rather than a nicely typeset claim.

`render.ts` guarantees the page uses no JavaScript and makes no external
requests, so it works on mobile data, offline from a saved file, and from a
printout.

### Decision

Encode the QR ourselves, in `packages/core/src/report/qr.ts`, and inline it as
SVG. Byte mode, error-correction level M, versions 1–10.

### Consequences

- **No external image service.** A `https://…/qr?data=` URL would break the
  no-requests guarantee, fail offline, and tell that service which vehicles are
  being sold and when — a leak with commercial value to exactly the wrong
  people.
- **No dependency.** The encoder is one algorithm with transcribed tables and
  no imports, which also lets `sync-edge-shared.sh` vendor it into the Deno
  Edge Function alongside the renderer.
- **The test decodes it.** `qr.test.ts` rasterises the matrix and runs it
  through jsQR — a decoder, not the encoder under test — and requires the
  original string back. This is not optional rigour: the first implementation
  passed every structural check (right size, finder patterns, quiet zone) while
  being unscannable, because the Reed–Solomon generator polynomial was built
  with its leading coefficient last and the format block was written
  transposed. Both produce a code that photographs perfectly and scans as
  nothing.
- **Ceiling of 213 characters**, and it throws above that rather than
  truncating. A silently truncated URL is a scannable code pointing at the
  wrong place, which is worse than no code.

## 2. KYC values are sealed behind an interface, and the seal is a stub

### Context

§11: national IDs and IBANs are never stored in plaintext. Migration 0018
enforces the floor — the columns reject anything that still _looks_ like a raw
identifier — but a check constraint cannot verify that a string is genuinely
ciphertext, only that it is not obviously plaintext.

The provider-upgrade flow (§5.1.1) is the first screen that sends these values.

### Decision

`features/shared/lib/kyc.ts` defines a `KycVault` interface with one method,
`seal()`, mirroring the shape of `otp-provider.ts` and `location-provider.ts`.
The development implementation stores a one-way digest plus a four-character
tail, marked `enc:dev:`.

### Consequences

- **This is not encryption, and is not presented as one.** It is a placeholder
  that keeps a readable identifier out of the dev database while the real
  mechanism is chosen.
- **The real implementation is server-side**, in Supabase Vault / pgsodium,
  with the key never leaving the database — which is blocked on ADR-0010
  (region and PDPL), still open. Nothing in the app reads these values back;
  ops verification reads them server-side, so moving the seal to the server is
  a change to one file and one migration, not to any screen.
- **Until then, do not accept real KYC data.** A dev-sealed IBAN cannot be paid
  out to, and a dev-sealed ID cannot be verified against Nafath. This is a
  blocker on onboarding real providers, and is listed as such.
