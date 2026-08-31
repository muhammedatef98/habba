/**
 * The Habba wordmark — the name with the gust over it.
 *
 * The Arabic lockup is the primary one, and its idea is that the shadda over
 * the بـ is redrawn as two swept gust strokes: the accent carries the motion,
 * so the letterforms stay untouched and fully connected. That is why this is
 * live text with an overlay rather than a flattened image — the letters have to
 * remain real letters, and Arabic shaping is the renderer's job.
 *
 * Almarai 800 for Arabic and Outfit 600 for Latin, as the design specifies.
 * Almarai is loaded for this component alone; body copy stays in IBM Plex Sans
 * Arabic.
 *
 * ⚠️ The word is written WITHOUT the shadda (هبة, not هبّة) because the gust
 * replaces it. Rendering both stacks a mark on a mark.
 */

import { useState } from 'react';
import { Text as RNText, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from './theme.js';

export type WordmarkScript = 'arabic' | 'latin';

export interface HabbaWordmarkProps {
  /** Height of the word itself. The gust scales with it. */
  readonly size?: number;
  readonly script?: WordmarkScript;
  /** Defaults to the theme's primary. The gust is always the accent. */
  readonly color?: string;
  readonly accent?: string;
}

/** Both strokes of the gust, on the design's 120×60 grid. */
const LEAD = 'M116 40 C 86 14, 46 8, 4 12 C 42 22, 80 30, 108 52 C 115 52, 119 46, 116 40 Z';
const TRAIL = 'M96 58 C 72 42, 46 36, 16 34 C 44 44, 68 52, 86 68 C 93 68, 98 63, 96 58 Z';

export function HabbaWordmark({ size = 48, script = 'arabic', color, accent }: HabbaWordmarkProps) {
  const theme = useTheme();
  const ink = color ?? theme.colors.primary;
  const gust = accent ?? theme.colors.accent;

  const isArabic = script === 'arabic';
  const word = isArabic ? 'هبة' : 'Habba';

  /**
   * The word's rendered width, measured rather than assumed.
   *
   * Percentage offsets were tried first and are not reliable here: the box is
   * auto-sized, RTL changes which edge a percentage resolves from, and the gust
   * kept landing beside the word instead of over it. A measured pixel anchor
   * behaves identically in both directions.
   */
  const [wordWidth, setWordWidth] = useState(0);
  const measure = (event: LayoutChangeEvent) => setWordWidth(event.nativeEvent.layout.width);

  const gustWidth = size * (isArabic ? 0.5 : 0.9);
  const gustTop = isArabic ? -size * 0.01 : -size * 0.22;
  // Inset from the side the word starts on: the بـ sits about a third in from
  // the right in Arabic, and the Latin gust rides over the "ab".
  const gustInset = wordWidth * (isArabic ? 0.26 : 0.28);

  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <RNText
        onLayout={measure}
        allowFontScaling={false}
        style={{
          fontFamily: isArabic ? 'Almarai_800ExtraBold' : 'Outfit_600SemiBold',
          fontSize: size,
          lineHeight: size * 1.15,
          letterSpacing: isArabic ? 0 : -size * 0.035,
          color: ink,
          writingDirection: isArabic ? 'rtl' : 'ltr',
        }}
      >
        {word}
      </RNText>

      {wordWidth > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            // Physical edges, not logical ones: the anchor is the side the word
            // starts on — right for Arabic, left for Latin — and a logical
            // inset would flip that and undo the whole point.
            ...(isArabic ? { right: gustInset } : { left: gustInset }),
            top: gustTop,
            width: gustWidth,
            height: gustWidth / 2,
          }}
        >
          <Svg width="100%" height="100%" viewBox="0 0 120 60">
            <Path d={LEAD} fill={gust} />
            {/* Lighter: this is the tail of the gust, not a second gust. */}
            <Path d={TRAIL} fill={gust} opacity={0.55} />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}
