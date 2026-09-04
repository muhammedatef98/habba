# Contributing to Habba (هبّة)

Read `CLAUDE.md` first — it is the permanent spec context and the working
agreement. This file covers the two things it does not: what the automated
checks do and do not cover, and what a human still has to look at.

---

## Before every push

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm bundle
```

Or, with a local database running, the whole thing:

```bash
pnpm verify
```

**`pnpm bundle` is not optional.** Typecheck resolves types, lint reads syntax,
and the unit tests load pure modules — none of them ever asks Metro to build the
app. A missing native dependency clears all three and fails on the first device
that opens the app. That has already happened once here.

---

## What the automated checks cannot see

Nobody working on this repo through an agent has a simulator. The tests cover
logic thoroughly, rendering shallowly, and appearance not at all. These are the
failures that reached a real phone with a fully green pipeline:

- a tab bar that stopped rendering
- a navigator that stopped filling the screen
- text rendering in the system font because the design system named a face
  nothing had loaded
- unreadable copy in dark mode that looked perfect in light mode

Every one of them is a thing a person sees in two seconds and no assertion in
this repo was watching. Hence the list below.

---

## Manual checklist

Run through this on a **preview build**, not Expo Go — see the next section for
why that distinction matters more here than in most projects.

### Direction and language

Habba is Arabic-first and RTL-first (`CLAUDE.md` §2.1), and direction is where
this app breaks most often.

- [ ] **Arabic:** headings, section titles and list rows sit on the **right**
- [ ] **Arabic:** الرئيسية is at the **right** end of the tab bar, حسابي at the left
- [ ] **English:** the exact mirror of both
- [ ] Switch the language in حسابي, reopen the app, and check both again — the
      platform's RTL flag only changes on the _next_ launch, and that gap has
      produced a mirrored screen more than once
- [ ] Phone numbers, plates, VINs and prices still read left-to-right inside
      Arabic copy
- [ ] Back arrows and chevrons point the right way in both languages

### Appearance

- [ ] Dark mode: every screen, looking for text that has gone invisible against
      its own background. **Check dark before assuming light is representative**
      — a token can be perfectly readable in one scheme and 1.15:1 in the other
- [ ] Light mode: the same pass
- [ ] Arabic text is IBM Plex Sans Arabic, not the system font. If a heading
      looks like San Francisco or Roboto, a face failed to load and RN did not
      warn

### Layout

- [ ] The app fills the screen — no strip of background around the navigator
- [ ] The tab bar is present on الرئيسية, طلباتي and حسابي
- [ ] Enlarge the system text size to its largest normal setting: labels still
      fit their buttons, nothing is clipped, the primary action is still on
      screen

### States

Turn off Wi-Fi and mobile data, then:

- [ ] The offline notice appears
- [ ] Lists say something went wrong and offer a retry — none of them claims
      you have no vehicles, no orders, or an empty logbook
- [ ] Turn the connection back on: the retry works

### Both platforms

- [ ] iOS
- [ ] Android

RTL, fonts and safe-area insets are the three areas where the two genuinely
diverge, and all three are load-bearing here.

---

## Expo Go vs a preview build

Expo Go is fine for iterating on copy and logic. It is **not** a faithful
preview of this app, for one reason that matters:

**Config plugins do not apply in Expo Go.** `app.json` sets
`expo-localization` with `forcesRTL`, which makes a real build right-to-left
from its first frame. Expo Go cannot apply that, so it runs in the state where
the platform disagrees with the locale — and any direction bug you see there
may not exist in a real build, while a real one may be hidden.

Native modules are the same story: Expo Go carries a fixed set, so anything
outside it only works in a build of your own.

```bash
cd apps/customer
pnpm build:preview
```

First time on a machine: `npx eas login`, then `npx eas init` inside the app
directory to create the project. The `preview` profile produces an installable
APK on Android and a simulator build on iOS.

---

## Two clones, or two branches will fight

If more than one agent session works on this repository at once, give each its
own working directory. Two sessions in one folder will check out each other's
branches, and the symptom — an app that looks like it changed on its own — costs
more to diagnose than the setup costs to avoid.

```bash
git worktree add ~/habba-<topic> <branch>
```

---

## Tests

Two runners, split by filename, and the split is not a preference:

- **Vitest** — everything pure. Fast, and the default.
- **Jest** (`*.render.test.tsx`) — anything that renders. Vitest cannot load
  `react-native` at all; it ships Flow syntax and fails to parse. That
  limitation is why this repo had 34 test files and zero rendered components
  until a tab bar disappeared under a green build.

A render test that has never been watched to fail is not yet a guard. When you
add one, break the thing it protects, confirm it goes red, then restore it.
