/**
 * The design system's glyphs, drawn with plain <svg> for the console.
 *
 * Same geometry as the app's <Icon> (@habba/ui/icon-shapes) without
 * react-native-svg, so the icon an operator picks for a service is the one
 * the customer sees.
 */

import { ICON_SHAPES, type Shape } from '@habba/ui/icon-shapes';

const SHAPES = ICON_SHAPES as Readonly<Record<string, readonly Shape[]>>;

export function Glyph({ name, size = 20 }: { readonly name: string; readonly size?: number }) {
  const shapes = SHAPES[name] ?? SHAPES['alert'] ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes.map((shape, index) =>
        shape.kind === 'circle' ? (
          <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} />
        ) : shape.kind === 'rect' ? (
          <rect
            key={index}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.rx}
          />
        ) : (
          <path key={index} d={shape.d} />
        ),
      )}
    </svg>
  );
}
