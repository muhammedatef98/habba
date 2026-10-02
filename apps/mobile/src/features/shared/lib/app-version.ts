/**
 * Whether this build is older than the floor operators set (min_app_version,
 * 0081). Dotted numbers, compared part by part — "1.10.0" is newer than
 * "1.9.2", which a string comparison gets wrong.
 *
 * An empty or unreadable floor never blocks: a typo in the console must not
 * lock every customer out of the app.
 */
export function isBelowMinimumVersion(current: string, minimum: string): boolean {
  const parse = (version: string): number[] | null => {
    const trimmed = version.trim();
    if (!/^\d+(\.\d+)*$/.test(trimmed)) return null;
    return trimmed.split('.').map(Number);
  };

  const floor = parse(minimum);
  const build = parse(current);
  if (floor === null || build === null) return false;

  for (let index = 0; index < Math.max(floor.length, build.length); index++) {
    const have = build[index] ?? 0;
    const need = floor[index] ?? 0;
    if (have !== need) return have < need;
  }
  return false;
}
