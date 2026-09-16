/**
 * Which maintenance rules the scan can never reach.
 *
 * Pure, and in `src/lib` rather than inside the screen, for the same reason
 * `isSessionExpired` is: this encodes a claim about what the SERVER does, and a
 * claim nobody can test is a claim nobody can rely on. The screen draws a red
 * border from this; if it is wrong, the console either hides a dead rule or
 * libels a live one.
 *
 * ## What it mirrors
 *
 * `applicable_rules` (0029):
 *
 * ```sql
 * select distinct on (r.service_id) r.*
 *   from maintenance_rules r join vehicles v on v.id = p_vehicle_id
 *  where r.is_active
 *    and (r.make_id is null or r.make_id = v.make_id)
 *    and (r.model_id is null or r.model_id = v.model_id)
 *  order by r.service_id,
 *           (r.model_id is not null) desc,
 *           (r.make_id is not null) desc,
 *           r.created_at;
 * ```
 *
 * Two consequences, and the second is the one nothing in the product surfaced.
 *
 * 1. One rule per service per vehicle. A model rule beats a make rule beats a
 *    generic one.
 * 2. Among rules of the SAME specificity, `created_at` breaks the tie and the
 *    OLDEST wins. So "correcting" an interval by adding a new rule beside the
 *    old one changes nothing at all, silently — the new row is never reached.
 *
 * ## What it deliberately does NOT report
 *
 * A generic rule that loses to a make rule is not shadowed. It loses only for
 * that make, and still fires for every other car on the road. Reporting it
 * would be false, and a warning that is sometimes false is a warning operators
 * learn to scroll past — which costs more than the one it was meant to catch.
 *
 * So rules compete only inside an identical scope: same service, same make,
 * same model.
 */

/** The fields the rule depends on. Narrow on purpose, so tests state facts. */
export interface ShadowCandidate {
  readonly id: string;
  readonly serviceId: string;
  readonly makeId: string | null;
  readonly modelId: string | null;
  readonly nameAr: string;
  readonly isActive: boolean;
  /** ISO 8601. Compared as a string, which sorts correctly for ISO. */
  readonly createdAt: string;
}

/**
 * Maps each dead rule's id to the name of the rule that beat it.
 *
 * Inactive rules take no part: the scan filters `is_active`, so a rule somebody
 * switched off shadows nothing — and switching the winner off is exactly how an
 * operator fixes one of these.
 */
export function shadowedRules(rules: readonly ShadowCandidate[]): ReadonlyMap<string, string> {
  const shadowed = new Map<string, string>();
  const byScope = new Map<string, ShadowCandidate[]>();

  for (const rule of rules) {
    if (!rule.isActive) continue;
    const scope = `${rule.serviceId}|${rule.makeId ?? ''}|${rule.modelId ?? ''}`;
    const group = byScope.get(scope);
    if (group === undefined) byScope.set(scope, [rule]);
    else group.push(rule);
  }

  for (const group of byScope.values()) {
    if (group.length < 2) continue;
    // Oldest first, matching the `r.created_at` tiebreak. Ties on the timestamp
    // itself fall back to the id so the answer is stable rather than dependent
    // on the order rows arrived in — two rules written in the same millisecond
    // is not a case to be non-deterministic about.
    const ordered = [...group].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const winner = ordered[0] as ShadowCandidate;
    for (const loser of ordered.slice(1)) shadowed.set(loser.id, winner.nameAr);
  }

  return shadowed;
}
