import { describe, expect, test } from 'vitest';
import {
  ARABIC_LINE_HEIGHT_RATIO,
  fontSize,
  darkColors,
  iconSize,
  letterSpacing,
  lightColors,
  lineHeightFor,
  MIN_TOUCH_TARGET,
  zIndex,
  type ColorScheme,
} from './tokens.js';

/** WCAG 2.2 relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

const schemes: ReadonlyArray<readonly [string, ColorScheme]> = [
  ['light', lightColors],
  ['dark', darkColors],
];

describe('colour contrast (WCAG 2.2)', () => {
  // Half of emergency usage happens after sunset (§8), so dark mode has to
  // clear the same bar as light — it is a designed scheme, not a filter.
  test.each(schemes)('%s: body text on background meets 4.5:1', (_name, colors) => {
    expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)('%s: muted text still meets 4.5:1', (_name, colors) => {
    expect(contrast(colors.textMuted, colors.background)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)('%s: button labels meet 4.5:1 on their surfaces', (_name, colors) => {
    expect(contrast(colors.primaryText, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.accentText, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.emergencyText, colors.emergency)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)(
    '%s: each provenance badge is readable on its own surface',
    (_name, colors) => {
      // ADR-0005. Note what is NOT asserted here: luminance contrast *between*
      // the two badge colours. In dark mode both must be light enough to read on
      // a dark surface, which necessarily puts their luminance close together —
      // demanding separation there would force one of them to be unreadable.
      //
      // The distinction is carried by hue, by the border and weight difference
      // in ProvenanceBadge, and above all by the wording ("موثّق من هبّة" vs
      // "مُدخل من المالك"), which is the only cue that survives colour blindness.
      // What this test guards is that neither becomes unreadable.
      expect(contrast(colors.verified, colors.verifiedSubtle)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.selfReported, colors.selfReportedSubtle)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.selfDocumented, colors.selfDocumentedSubtle)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(colors.verified).not.toBe(colors.selfReported);
      expect(colors.verifiedSubtle).not.toBe(colors.selfReportedSubtle);
      // Three levels, three appearances. Two of them looking identical would
      // make the badge decorative.
      expect(new Set([colors.verified, colors.selfReported, colors.selfDocumented]).size).toBe(3);
    },
  );
});

describe('status colour pairs (fg on subtle background, WCAG 2.2)', () => {
  test.each(schemes)('%s: successFg on successSubtle meets 4.5:1', (_name, colors) => {
    expect(contrast(colors.successFg, colors.successSubtle)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)('%s: warningFg on warningSubtle meets 4.5:1', (_name, colors) => {
    expect(contrast(colors.warningFg, colors.warningSubtle)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)('%s: emergencyFg on emergencySubtle meets 4.5:1', (_name, colors) => {
    expect(contrast(colors.emergencyFg, colors.emergencySubtle)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)('%s: textLink on background meets 4.5:1', (_name, colors) => {
    expect(contrast(colors.textLink, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textLink, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(schemes)('%s: infoFg on infoSubtle meets 4.5:1', (_name, colors) => {
    expect(contrast(colors.infoFg, colors.infoSubtle)).toBeGreaterThanOrEqual(4.5);
  });

  // The design used the accent amber itself for price numerals, at 3.44:1 on
  // white. Prices are the single most consequential number on the screen, so
  // accentFg exists purely to carry amber as *text* and must stay readable.
  test.each(schemes)('%s: accentFg is readable as text on surfaces', (_name, colors) => {
    expect(contrast(colors.accentFg, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.accentFg, colors.background)).toBeGreaterThanOrEqual(4.5);
    // The guest banner. This pair was untested, and the screens were painting
    // `accentText` here instead — the label colour for a *filled* amber button,
    // which is dark petrol in dark mode. It measured 1.15:1 on this surface:
    // dark green on dark brown, on the one banner asking a guest to save the
    // logbook they can otherwise lose.
    expect(contrast(colors.accentFg, colors.accentSubtle)).toBeGreaterThanOrEqual(4.5);
  });

  // §8 reserves red for genuine emergencies. If the emergency colour ever drifts
  // close enough to the accent to be mistaken for it, that separation is gone.
  test.each(schemes)('%s: emergency is visibly distinct from accent', (_name, colors) => {
    expect(colors.emergency).not.toBe(colors.accent);
    expect(contrast(colors.emergency, colors.accent)).toBeGreaterThanOrEqual(1.5);
  });
});

describe('accentText is a button label, not body text', () => {
  test.each(schemes)('%s: accentText is readable on a filled accent', (_name, colors) => {
    expect(contrast(colors.accentText, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  test('in dark mode it is unusable on accentSubtle — which is how the bug shipped', () => {
    // Light mode hides this completely: `accentText` there is near-black ink,
    // which measures 15:1 on the cream `accentSubtle` and looks perfect. In
    // dark mode the same token is dark petrol on dark brown — 1.15:1 — so the
    // guest banner rendered as an unreadable green block for exactly half the
    // users, and looked correct to anyone who checked in light mode.
    //
    // Asserted rather than merely commented so that if someone ever makes
    // `accentText` safe on this surface, this test fails and tells them the
    // note above is now stale.
    expect(contrast(darkColors.accentText, darkColors.accentSubtle)).toBeLessThan(4.5);
    expect(contrast(lightColors.accentText, lightColors.accentSubtle)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('token structure invariants', () => {
  test('iconSize values are ascending', () => {
    const values = Object.values(iconSize);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1] ?? 0);
    }
  });

  test('zIndex overlay < modal < toast', () => {
    expect(zIndex.overlay).toBeLessThan(zIndex.modal);
    expect(zIndex.modal).toBeLessThan(zIndex.toast);
  });

  test('letterSpacing.normal is 0 (Arabic body copy default)', () => {
    expect(letterSpacing.normal).toBe(0);
  });
});

describe('type scale matches the design system', () => {
  // The scale drifted once already: 18/22/28/34/44 against the design's
  // 20/24/32/40, close enough to look intentional and wrong enough that no
  // heading matched the mockups. Pinned so the next drift fails here.
  test('every step is a size the design specifies', () => {
    expect(Object.values(fontSize)).toEqual([12, 14, 16, 20, 24, 32, 40]);
  });

  test("line heights land on the design's own pairings", () => {
    // The design lists these explicitly; they should fall out of the 1.7 ratio
    // rather than being maintained as a second table.
    expect(lineHeightFor(12)).toBe(20);
    expect(lineHeightFor(14)).toBe(24);
    expect(lineHeightFor(16)).toBe(27);
    expect(lineHeightFor(20)).toBe(34);
    expect(lineHeightFor(24)).toBe(41);
    expect(lineHeightFor(32)).toBe(54);
    expect(lineHeightFor(40)).toBe(68);
  });
});

describe('typography and touch targets', () => {
  test('Arabic line height uses the 1.7 ratio (§8)', () => {
    expect(ARABIC_LINE_HEIGHT_RATIO).toBe(1.7);
    expect(lineHeightFor(16, 'arabic')).toBe(27);
    expect(lineHeightFor(16, 'latin')).toBeLessThan(lineHeightFor(16, 'arabic'));
  });

  test('minimum touch target is 48dp and never shrinks', () => {
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(48);
  });
});
