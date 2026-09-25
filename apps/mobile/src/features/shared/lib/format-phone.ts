/**
 * A phone number, as a person reads it.
 *
 * Stored E.164 (`+966501234567`), and shown that way it was wrong twice over
 * in Arabic: the bidi algorithm puts a leading `+` at the paragraph's start,
 * which in a right-to-left paragraph is the right-hand end — «966501234567+»
 * — and twelve unbroken digits are hard to check against the number you know.
 *
 * Grouped the way Saudi numbers are said (+966 50 123 4567), and wrapped in a
 * left-to-right isolate (U+2066 … U+2069) so it lays out the same inside
 * Arabic text as it does on its own.
 */

const LRI = '⁦';
const PDI = '⁩';

export function formatPhone(e164: string): string {
  const saudiMobile = /^\+966(5\d)(\d{3})(\d{4})$/.exec(e164);
  const grouped =
    saudiMobile === null ? e164 : `+966 ${saudiMobile[1]} ${saudiMobile[2]} ${saudiMobile[3]}`;
  return `${LRI}${grouped}${PDI}`;
}
