import "server-only";
import type { Revision, RevisionResourceType } from "../types";

/**
 * 🔒 THE TS TWIN OF `revisions_member_select` — the predicate half of the pair
 * `scripts/check-rls-pair-gate.ts` requires (INVARIANTS §14).
 *
 * ⚠ **IT STATES NO VISIBILITY RULE OF ITS OWN, AND NEITHER DOES ITS POLICY
 * TWIN.** The policy is one `CASE` handing the question to
 * `dopl_knowledge_base_readable` / `dopl_ontology_readable`; this is the same
 * sentence in TypeScript — *a revision is visible exactly when the thing it is
 * about is visible*. A second statement of "who may read a knowledge base" here
 * would be a rule that can disagree with the one that matters, which is the
 * whole defect the pair gate exists to catch, one level up.
 *
 * ⚠ SO THE REACH IS AN ARGUMENT, NOT A LOOKUP. The caller has already asked the
 * resource's OWN service (`knowledge/server/service-bases.ts › getBaseById`,
 * `› readEntry`, …) and hands the answer in. That is what keeps this file
 * ignorant of what a knowledge base is, and it is why a new resource family
 * needs no edit here — only an arm in the SQL `CASE` and a caller that resolves
 * its own reach.
 */

/** `resourceType:resourceId`, the key both halves of a reach set agree on. */
export function reachKey(type: RevisionResourceType, id: string): string {
  return `${type}:${id}`;
}

/**
 * Every resource the caller has ALREADY been proved to reach, by that
 * resource's own service. Built with {@link reachKey}.
 */
export interface RevisionReach {
  readonly reachable: ReadonlySet<string>;
}

export function revisionReach(
  refs: ReadonlyArray<{ resourceType: RevisionResourceType; resourceId: string }>
): RevisionReach {
  return {
    reachable: new Set(refs.map((r) => reachKey(r.resourceType, r.resourceId))),
  };
}

/**
 * May the caller see this revision?
 *
 * ⚠ FAILS CLOSED on a resource the reach set does not name — including one that
 * has since been PERMANENTLY DELETED, which is the same answer the SQL `EXISTS`
 * arms give once the row is gone. A history row about a resource nobody can
 * point at any more is not readable, and the alternative direction is a leak.
 */
export function canSeeRevision(
  revision: Pick<Revision, "resourceType" | "resourceId">,
  reach: RevisionReach
): boolean {
  return reach.reachable.has(reachKey(revision.resourceType, revision.resourceId));
}
