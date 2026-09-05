/**
 * The design system, as CSS custom properties.
 *
 * Generated from `@habba/ui/tokens` rather than retyped, so the admin cannot
 * drift from the apps. That subpath exists precisely because `tokens.ts` is
 * pure TypeScript with no React Native imports — the components could not cross
 * to the web, but the palette, the scale and the spacing can, and those are
 * what "matching the design" actually means.
 *
 * ⚠️ The design bundle contains no admin screens. It specifies the palette,
 * type scale, spacing, the component set and the RTL mirror; it does not
 * specify a dashboard. So this file is the design, and the layout above it is
 * judgement applied within it — worth being explicit about rather than
 * implying a mockup was followed.
 */

import {
  darkColors,
  fontSize,
  lightColors,
  radius,
  spacing,
  lineHeightFor,
  type ColorScheme,
} from '@habba/ui/tokens';

function colorVars(scheme: ColorScheme): string {
  return Object.entries(scheme)
    .map(([name, value]) => `    --color-${kebab(name)}: ${value};`)
    .join('\n');
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Emitted as a string and injected once, rather than shipped as a hand-written
 * stylesheet. A second copy of the palette is a second place for it to be
 * wrong.
 */
export function themeStylesheet(): string {
  const sizes = Object.entries(fontSize)
    .map(
      ([name, value]) =>
        `    --text-${name}: ${value}px;\n    --leading-${name}: ${lineHeightFor(value)}px;`,
    )
    .join('\n');

  const spaces = Object.entries(spacing)
    .map(([name, value]) => `    --space-${name}: ${value}px;`)
    .join('\n');

  const radii = Object.entries(radius)
    .map(([name, value]) => `    --radius-${name}: ${value}px;`)
    .join('\n');

  return `
  :root {
${colorVars(lightColors)}
${sizes}
${spaces}
${radii}
    --font-arabic: 'IBM Plex Sans Arabic', system-ui, sans-serif;
    --font-latin: 'Outfit', system-ui, sans-serif;
  }

  /* The ops console is used for hours at a stretch, often at night alongside
     the dispatch board. Following the operator's system preference is the
     right default here — unlike the customer's emergency flow, where the
     situation argues for dark regardless. */
  @media (prefers-color-scheme: dark) {
    :root {
${colorVars(darkColors)}
    }
  }
`;
}
