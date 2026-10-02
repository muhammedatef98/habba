/**
 * Row direction, for the launch where the platform disagrees with the locale.
 *
 * `Text` already resolves alignment from the layout direction rather than from
 * the string's script. Rows are the other half of that problem, and they are
 * harder: `flexDirection: 'row'` is laid out by Yoga against
 * `I18nManager.isRTL`, which `forceRTL` only changes on the *next* process
 * start (see `apps/customer/src/lib/rtl.ts`).
 *
 * So there is one state where the two disagree, and it is not a rare one: the
 * first launch after install. The app boots Arabic, stages the flip, and runs
 * that whole session with a left-to-right Yoga. Every `space-between` header in
 * the app then puts its title on the left — which is exactly the "الهيدز على
 * الشمال" complaint — and the same is true for one session after a language
 * switch.
 *
 * The rule is the same one `Text` follows: when the platform agrees with the
 * locale, let it lay the row out; when it does not, reverse the row here,
 * because nothing else is going to. Reversing in both cases would double-flip
 * and mirror the screen the other way.
 */

export type Direction = 'rtl' | 'ltr';

/**
 * @param locale  the direction of the language on screen right now
 * @param native  `I18nManager.isRTL` — what Yoga is currently laying out with
 * @param reverse the caller wants visual order to oppose reading order
 */
export function rowDirectionFor(
  locale: Direction,
  native: Direction,
  reverse = false,
): 'row' | 'row-reverse' {
  const platformIsBehind = locale !== native;
  return platformIsBehind === reverse ? 'row' : 'row-reverse';
}

/**
 * `alignSelf` / `alignItems` for "at the reading start" in a column.
 *
 * The same disagreement as `rowDirectionFor`, on the cross axis: `flex-start`
 * is the platform's start, so on the first Arabic launch a badge pinned with
 * it sat on the left while every heading around it sat on the right.
 */
export function alignStartFor(locale: Direction, native: Direction): 'flex-start' | 'flex-end' {
  return locale === native ? 'flex-start' : 'flex-end';
}
