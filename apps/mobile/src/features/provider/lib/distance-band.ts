/**
 * The distance to an offer, in the technician's language.
 *
 * `list_open_jobs` (0021) deliberately returns a coarse bucket, never a
 * distance — a precise figure plus the district would triangulate the
 * customer (ADR-0013). It words the bucket itself, in Arabic with
 * Arabic-Indic digits, so an English-speaking technician read «أقل من ٢ كم».
 *
 * The four wordings are the server's contract; this recognises them and
 * hands back a band the app words in either language. Anything it does not
 * recognise (a wording changed server-side before this was) is shown as the
 * server sent it, digits normalised, rather than hidden.
 */

import { toLatinDigits } from '@habba/core';

export type DistanceBand = 'under2' | 'from2to5' | 'from5to10' | 'over10';

const BANDS: Readonly<Record<string, DistanceBand>> = {
  'أقل من ٢ كم': 'under2',
  '٢–٥ كم': 'from2to5',
  '٥–١٠ كم': 'from5to10',
  'أكثر من ١٠ كم': 'over10',
};

export function distanceBandOf(bucket: string): DistanceBand | null {
  return BANDS[bucket.trim()] ?? null;
}

/** The label to show: the band in the UI language, else the server's text. */
export function distanceLabel(bucket: string, t: (key: string) => string): string {
  const band = distanceBandOf(bucket);
  return band === null ? toLatinDigits(bucket) : t(`provider.distanceBand.${band}`);
}
