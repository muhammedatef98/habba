# ADR-0014 — Toolchain, versions, and the Expo SDK question

- **Status:** Proposed — ⚠️ **blocks Phase 1**
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §3, §4

## Context

`CLAUDE.md` §3 pins the stack and says **"USE EXACTLY THIS"**. Most of it is unambiguous. Three
items need a decision before the first `pnpm install`, and one of them is a genuine conflict with
the spec.

### Expo SDK 52

The spec says _"Expo SDK 52+"_. SDK 52 is several release cycles old by now. The `+` permits a
newer version, and the reasons to take it are concrete rather than cosmetic:

- New Architecture (Fabric/TurboModules) maturity, which affects `react-native-reanimated`
  performance — and the spec explicitly asks for the dispatch-tracking screen to feel excellent.
- RTL handling and `I18nManager` behaviour have seen fixes; Habba is RTL-first from commit one.
- Starting two SDK versions behind means a migration during the build rather than after it.

Against: newer SDKs occasionally lag on third-party native modules. The ones that matter here are
`react-native-maps` and the Moyasar SDK (or its WebView flow).

**Recommendation:** target the **latest stable Expo SDK** at project init, after confirming
`react-native-maps` and the payment integration support it. Pin the exact version in this ADR once
chosen. Treat "52" in the spec as a floor, not a target.

### Postgres version

The spec says Postgres 15; Supabase provisions newer by default. ADR-0004's `canonical_json()`
avoids depending on `jsonb` text-rendering details precisely so this is not load-bearing, but the
version should be recorded here once the project exists.

### Detox and Expo Go

Detox (§3, E2E) cannot run against Expo Go — it needs a development build. Likewise
`react-native-maps` and any native payment SDK. **Development builds are required from Phase 1**,
which means Apple Developer and Google Play accounts, plus EAS configuration, are needed earlier
than a naive reading of the phase plan suggests.

Phase 1's acceptance criteria are reachable in Expo Go; Phase 3's are not. Setting up dev builds in
Phase 1 avoids a mid-build tooling detour.

## Decision

| Item            | Choice                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Node            | Latest LTS, pinned via `.nvmrc` and `engines`                                                  |
| Package manager | pnpm (per §3), version pinned via `packageManager` in root `package.json`                      |
| Monorepo        | pnpm workspaces, no Nx/Turbo in Phase 1 — add only if build times justify it                   |
| Expo SDK        | Latest stable at init (see above), pinned exactly, no `^` ranges on Expo packages              |
| TypeScript      | `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`                  |
| Lint            | ESLint flat config + `@typescript-eslint`, with a rule banning `any` and bare `@ts-ignore`     |
| Format          | Prettier, with `prettier-plugin-organize-imports`                                              |
| Tests           | Vitest for units; Detox on critical flows only (per §3)                                        |
| CI              | GitHub Actions: install → typecheck → lint → unit → **RLS test against an ephemeral Supabase** |

### `strict` is not enough on its own

`CLAUDE.md` §2.8 says `strict: true`, no `any`. Two additions matter for this codebase specifically:

- `noUncheckedIndexedAccess` — the codebase is full of lookups into catalogues, locale maps, and
  jsonb-derived structures where `undefined` is a real outcome.
- `exactOptionalPropertyTypes` — distinguishes "absent" from "explicitly undefined", which matters
  when building partial updates against a schema with meaningful nullability.

Both are stricter than the spec requires and cheap to adopt at commit one; expensive later.

### CI must run the RLS test against a real database

The spec requires `tests/rls.spec.ts` in CI (§6.9). This means CI spins up a Supabase instance,
applies all migrations, seeds test users, and asserts policies from _each role's_ perspective. A
mocked RLS test is worthless — it tests the mock. This shapes the CI setup in Phase 1.

## ⚠️ Owner decision required

1. **Expo SDK: latest stable, or pin to 52 as written?** Recommendation: latest stable.
2. Apple Developer and Google Play accounts — do these exist? Needed for development builds.
3. GitHub org/repo for CI, and is GitHub Actions the CI choice?
4. Bundle identifiers — proposed `sa.habba.customer` and `sa.habba.provider`. Confirm the reverse-DNS
   namespace matches the domain you own.
