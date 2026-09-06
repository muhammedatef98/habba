# تقرير هبّة — the PDF layout

Three A4 pages, Arabic RTL, generated on the device and shared as a file.
The decision to drop the public page is ADR-0019; this is what replaces it.

**Layout canvas:** https://claude.ai/code/artifact/3f9e3eb0-7aef-4e4a-963f-8bbd945d53ae

Pages read right to left on that canvas — page 1 is the rightmost artboard.

## Where every value comes from

The PDF renders the payload `generate_habba_report()` already produces. Nothing
is computed in the app that the server does not already send, so the printed
document and the database cannot drift.

| Page | Section | Payload source |
| --- | --- | --- |
| 1 | Car identity | `vehicle.{make_ar, model_ar, year, plate, vin, colour, current_mileage}` |
| 1 | «على هبّة منذ» | `ownership.months_on_habba` |
| 1 | Coverage bar and legend | `coverage.{total, habba_verified, self_documented, self_reported, third_party}` |
| 1 | Mileage chart | `mileage_history[]` |
| 2 | Timeline | `events[]`, grouped by the year in `occurred_at` |
| 2 | Badges | `events[].provenance` (ADR-0005) |
| 2 | Detail chips | `events[].details`, already allowlist-redacted by `redact_timeline_details()` |
| 3 | Verification statement | `chain.{is_valid, length}` |

## Decisions worth knowing before reading the layout

- **A4 at 96 px/inch (794×1123).** Body type is 14.5–16.5 px, which is the 12 pt
  print floor and above; only labels, dates and the footer go to 12–13 px.
- **No flood fills.** The masthead is a 3 px petrol rule, not a filled band —
  a full-bleed dark header drinks ink on every copy anyone prints.
- **Grouped by the year the work happened**, newest first, matching the logbook
  screen. Paper and app tell the same story in the same order.
- **The mileage chart runs right to left**, oldest reading at the right, with
  both ends direct-labelled so the direction cannot be misread. One series, one
  hue, no legend — the heading names it.
- **Latin numerals** (61,200 — not ٦١,٢٠٠), matching `formatNumber()` in
  `render.ts` and build prompt §8.
- **Owner identity is absent by construction**, not by the renderer remembering
  to omit it: the payload has no owner fields at all, and the redaction is an
  allowlist. Page 1 and page 3 both say so in Arabic, because a buyer should be
  able to see that it is deliberate.

## Two things the payload does not carry yet

Both are drawn on page 3 as they should look. Neither can be built from what
`get_habba_report()` returns today:

1. **Warranty status** («ساري» / «منتهٍ»). The payload carries `warranty_days`
   as a per-job detail — a duration, not a state. Live warranties live in the
   `warranties` table and the `active_warranties` view (0025), which the report
   payload does not read. Needs a `warranties` section added to the payload in
   `generate_habba_report()`.
2. **The inspection score's scale and recommendation.** `inspection_score`
   arrives as a bare number in `details`; "84" with no denominator means
   nothing on paper. Full inspection reports live in `inspection_reports`
   (0026) with their own tokens.

Until those land, page 3 can only show what the events carry: the warranty
duration per job, and the score as a number.

## Not in this layout, deliberately

- **No QR and no link** — ADR-0019.
- **No Hijri dates.** Build prompt §5 asks for Hijri alongside Gregorian in the
  UI; the existing HTML report never did it, and adding it here would be a
  change of content rather than of format. Worth a separate decision.
