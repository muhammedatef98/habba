# ADR-0011 — Saudi identifier formats: plates, IBAN, national ID, VAT number

- **Status:** Proposed — plate mapping ⚠️ **must be verified against an official source** before seeding
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §5; build prompt §6.2, §6.4

## Context

`CLAUDE.md` §5 specifies these formats in one paragraph each. Two of them are under-specified in
ways that will reject valid real-world input, and the plate example in the spec appears to be wrong.

## Decision

### Plate numbers

The spec says _"3 Arabic letters + 4 digits"_ with the example `أ ب ج ١٢٣٤` / `A B J 1234`.

Three corrections:

**1. Digit count is 1–4, not exactly 4.** Saudi plates carry between one and four digits. Requiring
four rejects a meaningful number of real plates — including older and low-number plates, which
disproportionately belong to exactly the kind of customer worth keeping.

**2. Only a restricted letter set is used.** Saudi plates use a fixed subset of Arabic letters,
each with a defined Latin equivalent chosen to be visually unambiguous. The commonly cited mapping:

| ا/أ | ب   | ح   | د   | ر   | س   | ص   | ط   | ع   | ق   | ك   | ل   | م   | ن   | هـ  | و   | ي   |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A   | B   | J   | D   | R   | S   | X   | T   | E   | G   | K   | L   | Z   | N   | H   | U   | V   |

Note the mapping is **not phonetic** — `ص→X`, `م→Z`, `ي→V` — which is precisely why it must come
from an authoritative source and not from transliteration intuition.

**⚠️ The spec's own example looks incorrect:** it uses `ج` mapped to `J`, but `ج` does not appear in
the standard set; `ح` is the letter that maps to `J`. Before seeding any validation table, the
mapping must be verified against an official MOI/Absher source. Getting this wrong means failing to
match a car to its own logbook — the one thing the product cannot get wrong.

**3. Letter ordering differs between scripts.** Arabic reads right-to-left and Latin left-to-right,
so the Latin rendering of a plate is conventionally the **reverse** of the Arabic letter sequence.
This must be confirmed and then covered by tests in both directions, or `plate_ar` and `plate_en`
will disagree about the same physical car.

**Storage and search.** Store `plate_ar` and `plate_en` as entered, plus a generated
`plate_normalised` column: Latin letters, Latin digits, no spaces, uppercase. All lookups go
through the normalised column. Input accepts either script and either digit set (Arabic-Indic
`٠١٢٣٤٥٦٧٨٩` and Latin `0123456789`) and normalises on the way in.

### IBAN

`SA` + 22 further characters = **24 total**. Validate with ISO 13616 mod-97: move the first four
characters to the end, map letters to numbers (`A`=10 … `Z`=35), and confirm `mod 97 = 1`.

Implemented in `packages/core` with unit tests, and mirrored as a Postgres check on write — the
client is never the only validator (`CLAUDE.md` §2.2). Stored encrypted (§11).

### National ID / Iqama

10 digits; `1` prefix = Saudi national, `2` prefix = Iqama. Beyond the prefix and length, Saudi IDs
carry a **check digit** (a Luhn-style algorithm over the first nine digits). Implement and unit-test
it — prefix-and-length validation alone accepts obvious typos, and this field gates provider payouts.

Stored encrypted (§11). Never logged, never in an error message, never in a push notification.

### VAT number

15 digits, first and last both `3`. Digits 11–13 encode an entity/branch identifier. Validate
length, prefix, and suffix; treat deeper structural validation as advisory only.

## Consequences

- `packages/core` gains a `saudi/` module: plate normalisation and transliteration, IBAN mod-97,
  national ID checksum, VAT format. All pure, all unit-tested, all shared between apps and mirrored
  in SQL where they gate writes.
- The plate letter map is seed data in a table (`plate_letters`), not a hardcoded constant, so a
  correction does not require a deploy.
- Validation must be **permissive on input, strict on storage**: a stressed customer at the
  roadside typing their plate should not fight a regex. Accept messy input, normalise aggressively,
  reject only what cannot be interpreted.

## ⚠️ Owner decision required

1. Can you confirm the plate letter mapping and the Arabic/Latin ordering convention from an
   official source? This is the single highest-risk item in this ADR.
2. Confirm the spec's `ج → J` example is an error and `ح → J` is correct.
