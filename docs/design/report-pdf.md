# تقرير هبّة — the PDF layout

Three A4 pages, Arabic RTL, generated on the device and shared as a file.
The decision to drop the public page is ADR-0019; this is what replaces it.

**Layout canvas:** https://claude.ai/code/artifact/3f9e3eb0-7aef-4e4a-963f-8bbd945d53ae

Pages read right to left on that canvas — page 1 is the rightmost artboard.

## Where every value comes from

The PDF renders the payload `generate_habba_report()` already produces. Nothing
is computed in the app that the server does not already send, so the printed
document and the database cannot drift.

| Page | Section                 | Payload source                                                                  |
| ---- | ----------------------- | ------------------------------------------------------------------------------- |
| 1    | Car identity            | `vehicle.{make_ar, model_ar, year, plate, vin, colour, current_mileage}`        |
| 1    | «على هبّة منذ»          | `ownership.months_on_habba`                                                     |
| 1    | Coverage bar and legend | `coverage.{total, habba_verified, self_documented, self_reported, third_party}` |
| 1    | Mileage chart           | `mileage_history[]`                                                             |
| 2    | Timeline                | `events[]`, grouped by the year in `occurred_at`                                |
| 2    | Badges                  | `events[].provenance` (ADR-0005)                                                |
| 2    | Detail chips            | `events[].details`, already allowlist-redacted by `redact_timeline_details()`   |
| 3    | Verification statement  | `chain.{is_valid, length}`                                                      |

## Decisions worth knowing before reading the layout

- **A4 at 96 px/inch (794×1123).** Body type is 14.5–16.5 px, which is the 12 pt
  print floor and above; only labels, dates and the footer go to 12–13 px.
- **No flood fills.** The masthead is a 3 px petrol rule, not a filled band —
  a full-bleed dark header drinks ink on every copy anyone prints.
- **Grouped by the year the work happened**, newest first, matching the logbook
  screen. Paper and app tell the same story in the same order.
- **Counted nouns take their Arabic form.** «سجلان», not «٢ سجل» — the dual is
  not optional, and this is the artefact a seller hands to a buyer.
- **Every Latin run is isolated with `<bdi>`.** Otherwise `90915-YZZE1` prints
  as `YZZE1-90915` and `2026-01-05` as `05-01-2026`.
- **The mileage chart runs right to left**, oldest reading at the right, with
  both ends direct-labelled so the direction cannot be misread. One series, one
  hue, no legend — the heading names it.
- **Latin numerals** (61,200 — not ٦١,٢٠٠), matching `formatNumber()` in
  `render.ts` and build prompt §8.
- **Owner identity is absent by construction**, not by the renderer remembering
  to omit it: the payload has no owner fields at all, and the redaction is an
  allowlist. Page 1 and page 3 both say so in Arabic, because a buyer should be
  able to see that it is deliberate.

## The two payload gaps, now closed

The layout was drawn before the payload could fill them. Migration `0046` added
both, and page 3 renders them:

| Page | Section          | Payload source                                                                                   |
| ---- | ---------------- | ------------------------------------------------------------------------------------------------ |
| 3    | Warranty table   | `warranties[].{service_ar, completed_at, warranty_days, status, days_remaining, has_open_claim}` |
| 3    | Inspection score | `inspections[].{overall_score, score_scale, recommendation, template_ar, completed_at}`          |

A payload at `report_version` 1 predates both. Page 3 says so rather than
printing «لا يوجد ضمان» for a car whose warranties were simply never captured —
`carriesWarrantyAndScore()` is the check.

## Not in this layout, deliberately

- **No QR and no link** — ADR-0019.
- **No Hijri dates.** Build prompt §5 asks for Hijri alongside Gregorian in the
  UI; the existing HTML report never did it, and adding it here would be a
  change of content rather than of format. Worth a separate decision.
