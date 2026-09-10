/**
 * طلب طارئ — the one thing this app exists to do.
 *
 * Given real weight instead of being one more full-width button in a stack of
 * them: a deep petrol slab, a gust bleeding off the end edge, and roughly
 * twice the height of anything else on the screen. §8's "clear hierarchy
 * through scale contrast" is the whole brief here — on the old home this block
 * was the same visual weight as "احفظ حسابي", so the loudest thing on an
 * emergency app's home screen was an account-upsell.
 *
 * Teal, not red, and deliberately. §8 reserves red for an emergency already
 * under way — the design does not let it appear before the sixth screen of the
 * flow. A permanently red home screen is exactly the "everything is urgent"
 * failure the palette exists to prevent, and it would leave nothing louder to
 * say when something actually is wrong.
 *
 * The surface is a fixed deep petrol in BOTH themes rather than
 * `colors.primary`, which in dark mode resolves to the light teal 400 and
 * would turn the hero into the brightest object on a screen designed for
 * 2am. Contrast on the lighter end of the gradient: cream 8.19:1, petrol 200
 * 5.53:1, sand 400 5.24:1.
 */

import { View } from 'react-native';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { HabbaMark, Icon, Text, palette, rowDirectionFor, useTheme } from '@habba/ui';
import { LivePulseDot } from './LivePulseDot';

const HERO_HEIGHT = 156;

/** Cream on petrol, both fixed — see the note above about `colors.primary`. */
const INK = palette.light.bg;
const INK_SOFT = palette.petrol[200];
const BADGE_INK = palette.sand[400];

export interface EmergencyHeroProps {
  readonly onPress: () => void;
  readonly testID?: string | undefined;
}

export function EmergencyHero({ onPress, testID }: EmergencyHeroProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('home.emergencyCta')}
      accessibilityHint={t('home.emergencySubtitle')}
      style={({ pressed }) => [
        {
          minHeight: HERO_HEIGHT,
          borderRadius: theme.radius.xl,
          // Larger than the cards below it, so the hero is a different kind of
          // object rather than a bigger instance of the same one.
          padding: theme.spacing.lg,
          justifyContent: 'space-between',
          overflow: 'hidden',
          backgroundColor: palette.petrol[600],
          shadowColor: '#000',
          ...theme.elevation.md,
          // In dark mode the slab and the page are both deep petrol and the
          // shadow is invisible, so the hero stopped reading as a raised
          // object at all. A defined edge is the fix rather than a lighter
          // fill: brightening the gradient to separate it from the page pushed
          // the subtitle and the badge under 4.5:1, while this leaves every
          // text pair exactly as measured above. Same reasoning as Card's own
          // dark-mode border.
          ...(theme.mode === 'dark' ? { borderWidth: 1, borderColor: palette.petrol[500] } : null),
        },
        pressed ? { opacity: 0.95, transform: [{ scale: 0.99 }] } : null,
      ]}
    >
      {/* Diagonal, not vertical: a flat vertical fade on a wide block reads as
          a rendering artefact, while the diagonal gives the slab a light
          source and keeps the dark corner behind the gust.
          The light comes from the reading start, so the dark corner and the
          gust land together in both directions — pinned to one diagonal, the
          two coincided in English and sat on opposite sides in Arabic. */}
      <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <Defs>
          <LinearGradient
            id="heroFade"
            x1={theme.isRtl ? '1' : '0'}
            y1="0"
            x2={theme.isRtl ? '0' : '1'}
            y2="1"
          >
            <Stop offset="0" stopColor={palette.petrol[600]} />
            <Stop offset="1" stopColor={palette.petrol[800]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroFade)" />
      </Svg>

      {/* The gust, tucked into the corner and clipped by the card's own
          radius. Depth through overlap rather than through another shadow
          (§8). Sized to sit *in* the corner: at 190 the arc ran diagonally
          across the middle of the slab and read as a rendering artefact
          rather than as the mark. */}
      <HabbaMark
        size={124}
        on="dark"
        style={{
          position: 'absolute',
          // `end`, the logical edge, rather than a physical one or a
          // hand-rolled `isRtl ? left : right`. React Native's handling of
          // `left`/`right` on an absolutely positioned child under RTL is not
          // something to reason about from first principles — I got it
          // backwards twice — and `end` states the intent directly: the gust
          // belongs in the corner the text does NOT start from, so it always
          // sits in the empty half of the slab. Pinning it physically was fine
          // while the app was Arabic-only; in English the heading starts on the
          // left and ran straight over it.
          end: -26,
          bottom: -34,
          opacity: 0.13,
        }}
      />

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'center',
          gap: theme.spacing.sm,
          alignSelf: 'flex-start',
        }}
      >
        <LivePulseDot color={BADGE_INK} size={7} />
        <Text variant="label" style={{ color: BADGE_INK }}>
          {t('home.emergencyBadge')}
        </Text>
      </View>

      <View
        style={{
          flexDirection: rowDirectionFor(theme.direction, theme.nativeDirection),
          alignItems: 'flex-end',
          gap: theme.spacing.md,
        }}
      >
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text variant="title" style={{ color: INK }}>
            {t('home.emergencyCta')}
          </Text>
          <Text variant="bodySmall" style={{ color: INK_SOFT }}>
            {t('home.emergencySubtitle')}
          </Text>
        </View>

        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(246, 243, 237, 0.14)',
          }}
        >
          <Icon name="chevronForward" size={theme.iconSize.md} color={INK} />
        </View>
      </View>
    </Pressable>
  );
}
