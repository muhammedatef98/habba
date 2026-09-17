/**
 * The top of a screen: a way out, what this is, and at most one other action.
 *
 * ---
 *
 * WHAT THIS REPLACES
 *
 * The app has `headerShown: false` on every navigator, which is the right call
 * — a platform header cannot be made to follow the locale's direction on the
 * launch where `I18nManager` is still a restart behind it (direction.ts), and
 * the titles here are Arabic sentences rather than two-word labels.
 *
 * What it grew instead was a full-width ghost «رجوع» as the *last element of a
 * scrolling screen*. That is the same control the platform puts under the
 * thumb at the top-start corner, moved to the one place it cannot be reached
 * from: leaving the logbook meant scrolling past every service the car has
 * ever had. `add-vehicle` had no back at all — with `fade_from_bottom` there
 * is no edge-swipe to fall back on, so someone who tapped «أضف سيارة» by
 * mistake had to complete the form or force-quit.
 *
 * The booking flow already did this correctly, in a component only it could
 * use. This is that pattern, lifted out so the rest of the app can have it,
 * and `BookingSteps` now builds on it rather than beside it.
 *
 * ---
 *
 * DIRECTION
 *
 * Back sits at the *reading* start — right in Arabic, left in English — via
 * `Row`, which resolves against the locale and the platform together. The
 * chevron is `chevronBack`, named for meaning rather than for which way the
 * art points, and `Icon` mirrors it (icon-names.ts). Neither is a `left` or a
 * `right` anywhere in this file.
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from './Icon.js';
import { Row } from './Row.js';
import { Text } from './Text.js';
import { haptic } from './haptics.js';
import { useTheme } from './theme.js';

export interface ScreenHeaderProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  /**
   * A small label above the title, naming what the title is an instance *of* —
   * «دفتر السيارة» over a car's name, «الطلب» over an order number. The
   * logbook already did this by hand; it is here so it does not have to opt out
   * of the header to keep it.
   */
  readonly eyebrow?: string | undefined;
  /**
   * Omit and no back button is drawn — for a tab root, which has nowhere to go
   * back to. Callers guard with `router.canGoBack()`; a dead back button is
   * worse than none, because it is the control people reach for first.
   */
  readonly onBack?: (() => void) | undefined;
  /** Read out for the back control. Passed in so this stays free of i18next. */
  readonly backLabel?: string | undefined;
  /**
   * One trailing control at most — a share, an edit. Two is a toolbar, and a
   * toolbar at the top of an Arabic screen is where the title stops being
   * readable.
   */
  readonly action?: ReactNode | undefined;
  /**
   * Anything that belongs to the title and is not text — a plate badge, a
   * status pill, a count. Rendered under the title block, inside the header's
   * own rhythm rather than as the next thing on the screen.
   */
  readonly children?: ReactNode | undefined;
  readonly testID?: string | undefined;
}

/**
 * Visual size of the back control. Smaller than the 48dp floor on purpose: a
 * 48dp filled circle at the top of the screen competes with the title for
 * weight. `hitSlop` below restores the target without drawing it — §8 sets a
 * minimum tappable size, not a minimum painted one.
 */
const BACK_DIAMETER = 40;

export interface BackButtonProps {
  readonly onPress: () => void;
  /** Read out by assistive tech. Passed in so this stays free of i18next. */
  readonly label?: string | undefined;
  readonly testID?: string | undefined;
}

/**
 * The way out, on its own.
 *
 * Separate from `ScreenHeader` because the tracking screen needs one without a
 * title: each of its states draws its own headline, and the live states had no
 * exit whatsoever — someone watching a technician drive toward them could not
 * leave the screen to look at anything else in the app without force-quitting
 * it. That is the screen people sit on longest.
 */
export function BackButton({ onPress, label, testID }: BackButtonProps) {
  const theme = useTheme();
  const slop = Math.max(0, (theme.minTouchTarget - BACK_DIAMETER) / 2);

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onPressIn={() => haptic('light')}
      accessibilityRole="button"
      {...(label === undefined ? {} : { accessibilityLabel: label })}
      hitSlop={slop}
      style={({ pressed }) => [
        {
          width: BACK_DIAMETER,
          height: BACK_DIAMETER,
          borderRadius: theme.radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.surfaceSunken,
        },
        pressed ? { opacity: 0.6 } : null,
      ]}
    >
      {/* `chevronBack` is named for meaning, and `Icon` mirrors it — it points
          right in Arabic and left in English. */}
      <Icon name="chevronBack" size={theme.iconSize.md} color={theme.colors.text} />
    </Pressable>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  eyebrow,
  onBack,
  backLabel,
  action,
  children,
  testID,
}: ScreenHeaderProps) {
  const theme = useTheme();

  return (
    <View testID={testID} style={{ gap: theme.spacing.md }}>
      {onBack === undefined && action === undefined ? null : (
        <Row gap="sm" align="center">
          {onBack === undefined ? null : (
            <BackButton
              {...(testID === undefined ? {} : { testID: `${testID}-back` })}
              onPress={onBack}
              label={backLabel}
            />
          )}

          {/* Takes the slack so a trailing action is pushed to the far end
              without a `space-between` that would also stretch the chevron. */}
          <View style={{ flex: 1 }} />

          {action}
        </Row>
      )}

      <View style={{ gap: theme.spacing.xs }}>
        {eyebrow === undefined ? null : (
          <Text variant="label" tone="muted">
            {eyebrow}
          </Text>
        )}
        <Text variant="title">{title}</Text>
        {subtitle === undefined ? null : (
          <Text variant="body" tone="muted">
            {subtitle}
          </Text>
        )}
        {children}
      </View>
    </View>
  );
}
