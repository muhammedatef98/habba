/**
 * Links the operators set in the console (0082): the terms, the privacy
 * policy, the store pages.
 *
 * The database already refuses anything that is not https (0082); this is the
 * same rule on the phone, so a value that got past it some other way (an old
 * row, a server that has not migrated) is never handed to the OS to open.
 */

const HTTPS_LINK = /^https:\/\/[^\s/]+\.[^\s]+$/;

/** The link, if it is one the app will open; otherwise null. */
export function openableLink(url: string): string | null {
  const trimmed = url.trim();
  return HTTPS_LINK.test(trimmed) ? trimmed : null;
}

export interface TaggedSegment {
  readonly text: string;
  /** The tag the text was wrapped in, e.g. `terms` for `<terms>…</terms>`. */
  readonly tag: string | null;
}

/**
 * Splits a translated sentence with inline links — `…على <terms>الشروط</terms>
 * و<privacy>سياسة الخصوصية</privacy>.` — into plain and tagged runs, so each
 * language keeps its own word order and the links sit where its grammar puts
 * them. An unclosed tag is left as the text it is.
 */
export function splitTagged(sentence: string): readonly TaggedSegment[] {
  const segments: TaggedSegment[] = [];
  const pattern = /<([a-z]+)>(.*?)<\/\1>/g;
  let last = 0;
  for (const match of sentence.matchAll(pattern)) {
    const start = match.index;
    if (start > last) segments.push({ text: sentence.slice(last, start), tag: null });
    segments.push({ text: match[2] ?? '', tag: match[1] ?? null });
    last = start + match[0].length;
  }
  if (last < sentence.length) segments.push({ text: sentence.slice(last), tag: null });
  return segments;
}
