/**
 * The design's line icons.
 *
 * Transcribed from the design files rather than pulled from an icon library:
 * the set is small, the strokes are drawn to match the mark's weight, and a
 * general-purpose library would bring a thousand glyphs and its own visual
 * voice for the twenty-odd this product uses.
 *
 * All geometry is on a 24×24 grid with round caps and joins, stroked rather
 * than filled — except `star`, which the design fills because it reads as a
 * rating rather than an action.
 */

import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from './theme.js';

export type IconName =
  // services
  | 'tow'
  | 'battery'
  | 'tyre'
  | 'lockout'
  | 'fuel'
  | 'radiator'
  // navigation
  | 'home'
  | 'calendar'
  | 'wallet'
  | 'person'
  | 'chevronDown'
  | 'chevronBack'
  | 'arrow'
  // actions and status
  | 'phone'
  | 'chat'
  | 'check'
  | 'star'
  | 'mic'
  | 'flipCamera'
  | 'locate'
  | 'edit'
  | 'share'
  | 'bell'
  | 'alert'
  | 'gauge'
  // Bookable catalogue. The emergency set above was drawn first and these were
  // being borrowed from it — every periodic service rendered as `gauge`, which
  // made the booking list five identical rows with different words on them.
  | 'oil'
  | 'brake'
  | 'ac'
  | 'wash'
  | 'inspection'
  | 'wrench';

type Shape =
  | { readonly kind: 'path'; readonly d: string }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
    };

const p = (d: string): Shape => ({ kind: 'path', d });
const c = (cx: number, cy: number, r: number): Shape => ({ kind: 'circle', cx, cy, r });
const r = (x: number, y: number, width: number, height: number, rx: number): Shape => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
  rx,
});

const ICONS: Record<IconName, readonly Shape[]> = {
  tow: [p('M3 17h4l2-6h7l3 6h2'), c(7, 19, 2), c(18, 19, 2)],
  battery: [r(3, 8, 18, 10, 2), p('M7 8V6M17 8V6M8 13h3M13 13h3M14.5 11.5v3')],
  tyre: [c(12, 12, 8), c(12, 12, 3), p('M12 4v3M12 17v3M4 12h3M17 12h3')],
  lockout: [r(5, 10, 14, 10, 2), p('M9 10V7a3 3 0 0 1 6 0')],
  fuel: [p('M7 21V9l5-4 5 4v12'), p('M10 13h4')],
  radiator: [r(4, 5, 16, 14, 2), p('M8 5v14M12 5v14M16 5v14')],

  home: [p('M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z')],
  calendar: [r(4, 5, 16, 15, 2), p('M8 3v4M16 3v4M4 10h16')],
  wallet: [p('M5 8h14l-1 11H6z'), p('M9 8V6a3 3 0 0 1 6 0v2')],
  person: [c(12, 8, 3.5), p('M5 20c0-3.5 3-6 7-6s7 2.5 7 6')],
  chevronDown: [p('M6 9l6 6 6-6')],
  chevronBack: [p('M15 6l-6 6 6 6')],
  arrow: [p('M4 12h16M12 4l8 8-8 8')],

  phone: [
    p(
      'M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 4 5a2 2 0 0 1 2-2z',
    ),
  ],
  chat: [p('M20 12a7 7 0 0 1-7 7H8l-4 3v-5.5A7 7 0 0 1 11 5h2a7 7 0 0 1 7 7z')],
  check: [p('M5 13l4 4 10-10')],
  star: [p('M12 2l2.9 6.3 6.9.8-5 4.8 1.2 6.9L12 17.6 5.9 20.8 7.1 13.9l-5-4.8 6.9-.8z')],
  mic: [
    p('M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM7 11v1a5 5 0 0 0 10 0v-1M12 19v2'),
  ],
  flipCamera: [p('M15 8l5-3v14l-5-3zM4 7h11v10H4z')],
  locate: [c(12, 12, 3), p('M12 3v3M12 18v3M3 12h3M18 12h3')],
  edit: [p('M4 20h4l10-10-4-4L4 16zM14 6l4 4')],
  share: [p('M12 3v12M8 11l4 4 4-4M5 20h14')],
  bell: [p('M12 3a6 6 0 0 0-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 0 0-6-6zM10 20a2 2 0 0 0 4 0')],
  alert: [c(12, 12, 9), p('M12 8v5M12 16.5v.5')],
  // ⚠️ `gauge` was `M12 3v10M8 9l4 4 4-4M5 19h14` — a download arrow. It is
  // used for odometer readings, where a downward arrow says nothing at all.
  // Now a dial: an arc, a needle, and the two end ticks.
  gauge: [p('M4 17a8 8 0 0 1 16 0'), p('M12 17l4.5-4.5'), p('M4 17h1.5M18.5 17H20')],

  oil: [p('M12 3.5c3 3.5 5 6.5 5 8.8a5 5 0 0 1-10 0c0-2.3 2-5.3 5-8.8z')],
  brake: [c(12, 12, 7.5), c(12, 12, 2.5), r(16.5, 9, 4, 6, 1)],
  ac: [p('M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9')],
  wash: [c(9.5, 14.5, 4), c(16, 10, 3), c(17, 17.5, 2)],
  inspection: [r(6, 4, 12, 16, 2), p('M9.5 4h5v2.5h-5z'), p('M9.5 13l2 2 3.5-3.5')],
  wrench: [p('M19.5 4.5a4.5 4.5 0 0 1-6 6L6.5 17.5l-2-2L11.5 8.5a4.5 4.5 0 0 1 6-6l-3 3 2 2 3-3z')],
};

/** Filled rather than stroked — a rating, not an action. */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['star']);

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  /**
   * Defaults to the current text colour, which is right for icons beside text.
   * `ColorValue` rather than `string` so platform colours pass through — the
   * tab bar hands its icons exactly that.
   */
  readonly color?: ColorValue;
  readonly strokeWidth?: number;
}

export function Icon({ name, size, color, strokeWidth = 1.8 }: IconProps) {
  const theme = useTheme();
  const resolved = color ?? theme.colors.text;
  const dimension = size ?? theme.iconSize.md;
  const filled = FILLED.has(name);

  return (
    <Svg width={dimension} height={dimension} viewBox="0 0 24 24" fill="none">
      {ICONS[name].map((shape, index) => {
        const stroke = filled
          ? { fill: resolved }
          : {
              stroke: resolved,
              strokeWidth,
              strokeLinecap: 'round' as const,
              strokeLinejoin: 'round' as const,
            };

        if (shape.kind === 'circle') {
          return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} {...stroke} />;
        }
        if (shape.kind === 'rect') {
          return (
            <Rect
              key={index}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx={shape.rx}
              {...stroke}
            />
          );
        }
        return <Path key={index} d={shape.d} {...stroke} />;
      })}
    </Svg>
  );
}
