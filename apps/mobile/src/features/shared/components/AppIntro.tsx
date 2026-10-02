/**
 * The opening moment: a gust, and the name it carries.
 *
 * هبّة means a gust of wind, and rushing to someone's aid — so the name
 * arrives the way the word says: streaks of wind sweep across in the reading
 * direction, the wordmark is blown in on them, holds for a beat, and the
 * whole thing lifts away to show the app underneath. Under two seconds; this
 * is a door, not a show.
 *
 * Mounted once, over everything, by the root layout, on a cold start only —
 * coming back from the background is not "opening the app" and does not
 * replay it. With reduce-motion on it is a plain fade.
 *
 * The streaks move by `translateX` alone, never `left`/`right`: React Native
 * swaps those in RTL, and on the first Arabic launch the platform and the
 * locale disagree about which way that is (CLAUDE.md §6). A transform is
 * physical, so the direction is decided here, from the locale.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { HabbaWordmark, useReducedMotion, useTheme } from '@habba/ui';

/** The launch colour: the brand's petrol, in light and dark alike. */
export const INTRO_BACKGROUND = '#12514F';

const STREAKS = [
  { offset: -86, width: 0.46, delay: 0, opacity: 0.22 },
  { offset: -40, width: 0.7, delay: 70, opacity: 0.35 },
  { offset: 8, width: 0.55, delay: 150, opacity: 0.28 },
  { offset: 58, width: 0.8, delay: 40, opacity: 0.2 },
  { offset: 104, width: 0.4, delay: 200, opacity: 0.3 },
] as const;

export function AppIntro({ onDone }: { readonly onDone: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();

  const sweep = useRef(STREAKS.map(() => new Animated.Value(0))).current;
  const word = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;

  // The wind blows the way the page reads: right to left in Arabic.
  const from = theme.isRtl ? width : -width;

  useEffect(() => {
    const native = { useNativeDriver: true } as const;
    const leave = Animated.timing(exit, {
      toValue: 1,
      duration: 380,
      easing: Easing.in(Easing.cubic),
      ...native,
    });

    const run = reduced
      ? Animated.sequence([
          Animated.timing(word, { toValue: 1, duration: 250, ...native }),
          Animated.delay(500),
          leave,
        ])
      : Animated.sequence([
          Animated.parallel([
            ...sweep.map((value, index) =>
              Animated.timing(value, {
                toValue: 1,
                duration: 720,
                delay: STREAKS[index]?.delay ?? 0,
                easing: Easing.out(Easing.cubic),
                ...native,
              }),
            ),
            Animated.timing(word, {
              toValue: 1,
              duration: 620,
              delay: 180,
              easing: Easing.out(Easing.back(1.4)),
              ...native,
            }),
          ]),
          Animated.delay(420),
          leave,
        ]);

    run.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => run.stop();
  }, [exit, onDone, reduced, sweep, word]);

  return (
    <Animated.View
      testID="app-intro"
      accessible
      accessibilityLabel={t('common.appName')}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: INTRO_BACKGROUND,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
        },
      ]}
    >
      {reduced
        ? null
        : STREAKS.map((streak, index) => {
            const value = sweep[index] as Animated.Value;
            return (
              <Animated.View
                key={index}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: '50%',
                  width: width * streak.width,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: '#FFFFFF',
                  marginTop: streak.offset,
                  opacity: value.interpolate({
                    inputRange: [0, 0.3, 0.75, 1],
                    outputRange: [0, streak.opacity, streak.opacity, 0],
                  }),
                  transform: [
                    {
                      translateX: value.interpolate({
                        inputRange: [0, 1],
                        outputRange: [from, -from],
                      }),
                    },
                  ],
                }}
              />
            );
          })}

      <Animated.View
        style={{
          opacity: word,
          transform: [
            {
              // Carried in on the wind: from the side the streaks come from.
              translateX: word.interpolate({
                inputRange: [0, 1],
                outputRange: [reduced ? 0 : from * 0.18, 0],
              }),
            },
            { scale: word.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        }}
      >
        <View>
          <HabbaWordmark size={88} color="#FFFFFF" />
        </View>
      </Animated.View>
    </Animated.View>
  );
}
