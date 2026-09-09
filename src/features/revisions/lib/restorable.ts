import type { Revision } from "../types";

/**
 * **WHAT MAY BE WRITTEN BACK — ONE PREDICATE, BOTH FAMILIES, BOTH SIDES.**
 *
 * ⚠ **IT IS SHARED BY THE SERVER AND THE RENDERER ON PURPOSE.**
 * `server/service.ts › restoreRevision` refuses a row this rejects
 * (`REVISION_NOT_RESTORABLE`, 409) and `components/changelog-list.tsx` renders
 * no Restore control for one. A control that can only fail is worse than no
 * control, and two statements of "restorable" is how the button and the refusal
 * come to disagree.
 *
 * ⚠ **IT IS IN `lib/` AND NOT IN THE SERVICE**, because the service is
 * `server-only` and this is read in the renderer. Pure, no I/O.
 *
 * ── THE RULE, PER FAMILY ────────────────────────────────────────────────────
 *
 * KNOWLEDGE — a snapshot with a BODY. A `move` or a base rename carries none,
 * so there is nothing to write back and refusing is honest (writing `undefined`
 * would be a silent no-op the caller reads as a successful restore).
 *
 * ONTOLOGY — a FIELD row on an OBJECT, and nothing else:
 *   - `field` names what to write and `before` is what to write. A `create` /
 *     `delete` bundle (`{fields}`) has no `before` at all.
 *   - an ASSOCIATION row is refused: restoring an edge means re-pointing at a
 *     target that may since have been deleted or left the caller's audience, and
 *     Samuel's design says restore is per FIELD.
 *   - a CLUSTER row is refused: the only restore door that exists is
 *     `POST /api/ontology/objects/{objectId}/revisions/{revisionId}/restore`,
 *     and a predicate that admitted a cluster row would put a button on the
 *     roll-up whose only outcome is a 404.
 */
export function isRestorable(revision: Revision): boolean {
  if (revision.resourceType.startsWith("knowledge_")) {
    return revision.payload.body != null;
  }
  if (revision.resourceType !== "ontology_object") return false;
  if (revision.payload.association !== undefined) return false;
  return revision.payload.field !== undefined && revision.payload.before !== undefined;
}
