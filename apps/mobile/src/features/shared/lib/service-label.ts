/**
 * The short form of a service name, for tiles.
 *
 * The catalogue's names are written for a list, where there is room to say
 * "Battery jump or replacement". On an 86dp quick-service tile they truncate:
 * the English home screen read "Battery jump or replace…" and "Tyre puncture
 * or…", which is worse than a shorter label that ends.
 *
 * Derived rather than stored, because the head of these names is already the
 * subject and the tail is already the qualifier — "بطارية — شحن أو تبديل" is
 * "battery, and here is what we do to it". Cutting at the separator keeps the
 * subject and drops the qualifier, which is exactly what an icon beside it
 * already supplies. Adding a `short_name` column would mean asking ops to
 * write the same word twice and keep them in sync.
 */

/** Separators the catalogue uses between a service and its qualifier. */
const SEPARATORS = [' — ', ' – ', ' - '];
const CONJUNCTIONS = [' or ', ' أو '];

export function shortServiceName(name: string): string {
  for (const separator of SEPARATORS) {
    const index = name.indexOf(separator);
    if (index > 0) return name.slice(0, index).trim();
  }

  for (const conjunction of CONJUNCTIONS) {
    const index = name.indexOf(conjunction);
    // Only worth cutting when what remains still reads as a name. "Fuel
    // delivery" has no conjunction; "Tyre puncture or change" becomes "Tyre
    // puncture", which does.
    if (index > 0) return name.slice(0, index).trim();
  }

  return name.trim();
}
