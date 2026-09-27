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
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { isMirroredIcon, type IconName } from './icon-names.js';
import { ICON_SHAPES } from './icon-shapes.js';
import { useTheme } from './theme.js';

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

  // Mirrored on the viewBox rather than with a `transform: scaleX(-1)` style
  // on the host view: an SVG flipped by its own transform stays flipped if the
  // element is later re-parented into a differently-directed subtree, and the
  // stroke geometry is what should be reflected, not the box around it.
  const mirror = theme.isRtl && isMirroredIcon(name);

  return (
    <Svg width={dimension} height={dimension} viewBox="0 0 24 24" fill="none">
      <G {...(mirror ? { transform: 'translate(24, 0) scale(-1, 1)' } : {})}>
        {ICON_SHAPES[name].map((shape, index) => {
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
      </G>
    </Svg>
  );
}
