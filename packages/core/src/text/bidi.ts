/**
 * Bidirectional-text isolation.
 *
 * An Arabic sentence with a Latin number in it is a mixed-direction paragraph,
 * and the Unicode bidi algorithm resolves neutral characters — `+`, `-`, `•`,
 * spaces — by looking at what surrounds them. Inside an RTL sentence that means
 * a phone number reorders: `05• •••• •67` renders as `670••••050`, and `+966`
 * renders as `966+`. Neither is a typo the reader can correct for; both look
 * like the app printed the wrong number.
 *
 * The fix is to tell the algorithm that a span is its own left-to-right run.
 * `writingDirection: 'ltr'` does that for a whole `Text`, which is right when
 * the whole `Text` is the number and wrong when the number sits inside a
 * sentence — hence these marks, which isolate a span without touching the
 * paragraph around it.
 *
 * U+2066 LEFT-TO-RIGHT ISOLATE … U+2069 POP DIRECTIONAL ISOLATE, rather than
 * the older U+200E LEFT-TO-RIGHT MARK: isolates also stop the span from
 * influencing the direction of the text *after* it, which the marks do not.
 */

const LEFT_TO_RIGHT_ISOLATE = '⁦';
const POP_DIRECTIONAL_ISOLATE = '⁩';

/**
 * Wraps `text` so it renders left-to-right wherever it is embedded.
 *
 * Use for phone numbers, plates, IBANs, prices and any other Latin-digit run
 * appearing inside Arabic copy. Returns the input unchanged when empty, so it
 * is safe to apply to an optional value.
 */
export function ltrIsolate(text: string): string {
  if (text.length === 0) return text;
  return `${LEFT_TO_RIGHT_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}
