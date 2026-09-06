# ADR-0019 — تقرير هبّة becomes an in-app PDF, and the public link is dropped

- **Status:** Accepted
- **Date:** 2026-09-05
- **Supersedes:** the delivery half of ADR-0017 (the in-page QR). The QR encoder
  itself stays — see "What we keep".
- **Relates to:** ADR-0004 (hash chain), ADR-0005 (provenance), build prompt
  §7.3, §1 (the moat)

## Context

تقرير هبّة was designed as a public web page: `generate_habba_report()` mints a
token, the `report` Edge Function renders HTML at `<base>/r/<token>`, and a QR
on that page points back at the same URL so a buyer holding paper can reach the
live record.

That design was never delivered. A device check on 2026-09-05 found the chain
broken in two independent places at once:

- **`habba.sa` does not exist.** No DNS record, so the default
  `reportBaseUrl()` — and therefore every QR ever generated — pointed at a host
  that could not answer.
- **The `report` function had never been deployed**, and the deploy command in
  the runbook omitted `--no-verify-jwt`, so even once deployed the gateway would
  have answered `401` to a phone camera before the function ran.

Layers 1 and 4 — the database function and the QR encoder — were sound. What
was missing was infrastructure: a domain, DNS, a deploy, and an operational
commitment to keep a public endpoint alive.

The owner's judgement, recorded here as the decision's actual reasoning: a
domain and a public endpoint are a standing cost and a standing liability
before there is a single user, and the launch that matters is the one where an
owner can hand a buyer a document today.

## Decision

**The report is generated on the device, as a PDF, and shared like any other
file. There is no public link and no QR anywhere in the product.**

- `generate_habba_report()` keeps producing the frozen, redacted payload — the
  same function, unchanged.
- The app renders that payload to a PDF locally and hands it to the OS share
  sheet (AirDrop, WhatsApp, email, print).
- `supabase/functions/report` and `reportBaseUrl()` leave the flow.
- The PDF states, in Arabic on its last page, that it is a printed copy of a
  record inside the app and that independent confirmation means asking the
  seller to open the logbook in front of you.

Layout: `docs/design/report-pdf.md` and the canvas linked from it — three A4
pages, Arabic RTL, print-safe on white.

## What this gives up

Stated plainly, because it is the whole reason this is an ADR and not a commit
message.

1. **A buyer can no longer verify anything without the seller.** The public
   page was the only artefact a stranger could check on their own. A PDF is a
   document the seller chose to hand over; the buyer's trust now rests on the
   seller being present and cooperative.
2. **A PDF can be forged, and the hash chain cannot stop it.** The chain proves
   that rows in _our_ database were not rewritten. Nothing in a PDF is bound to
   that database: change "84" to "94" in any PDF editor and the file is
   indistinguishable from a real one to anyone without the app. The chain
   remains real and remains verified at generation time — but the printed claim
   that it was verified is itself unverifiable, which is a materially weaker
   thing than it sounds.
3. **The buyer → owner conversion loses its front door.** §1.3 of the build
   prompt makes the buyer receiving the logbook a zero-CAC acquisition channel.
   That depended on a buyer landing on a Habba page. A PDF ends in the buyer's
   downloads folder, and Habba is a name on a document rather than a place they
   have been.
4. **No revocation.** A public token could be expired or revoked; a PDF, once
   sent, exists forever. Anything in it is disclosed permanently.
5. **No read signal.** Whether a report was ever opened, and by how many people,
   was a genuine product signal about the moat's value. It is now unobservable.

None of these is fatal to the pilot. All of them get worse at scale, and (3) in
particular is a growth mechanism being switched off, not merely a feature
deferred.

## What we keep

- **The payload and its redaction.** `redact_timeline_details()` is an
  allowlist, so the PDF inherits the same guarantee the page had: the buyer sees
  the car's history and nothing about the owner — no name, phone, city or
  address, by construction rather than by the renderer remembering to omit them.
- **The hash chain, and verification at generation.** The app verifies the whole
  chain when it builds the PDF and refuses to produce one from a chain that does
  not verify. That is a real check; it is simply not one the reader can repeat.
- **`packages/core/src/report/qr.ts`.** Unused by this flow, kept because ZATCA
  invoicing (0030) needs a QR encoder and because reversing this decision needs
  it back.
- **`packages/core/src/report/render.ts`.** The HTML renderer stays as the
  reference for content and Arabic labels, and as the fastest route back if the
  public page returns.

## How to reverse this

Deliberately cheap, in this order:

1. Register a domain and point it at the project.
2. `supabase functions deploy report --no-verify-jwt`, and set
   `HABBA_PUBLIC_BASE_URL`.
3. Set `EXPO_PUBLIC_REPORT_BASE_URL` to match.
4. Put the QR back on the PDF's last page, encoding `<base>/r/<token>`.

Nothing in this decision deletes the database function, the token, the
`habba_reports` table, or the renderer — reversing it is configuration and one
page of layout, not a rebuild. Tokens minted while this ADR stands remain valid
and would resolve the moment the endpoint exists.

## Alternatives considered

- **Keep the public page and buy a domain now.** Rejected by the owner: cost and
  an operational commitment before the first user, to serve a page nobody has
  asked for yet.
- **Serve the report from the Supabase functions URL** (`<ref>.supabase.co/…`).
  Works today with no domain, and is what the manual test used. Rejected as a
  shipping answer: a project-ref URL in a QR on a printed document is both
  ugly and a hostage to the project ever being renamed or migrated.
- **Sign the PDF cryptographically** (a detached signature, or a signed PDF with
  a certificate). Addresses (2) directly, but a buyer with no app and no
  verifier gains nothing from a signature they cannot check, and it needs a key
  and a key-management story we do not have. Worth revisiting when a verifier
  exists.
