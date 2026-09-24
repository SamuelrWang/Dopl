/**
 * Rollback for `useOntology()`'s optimistic deletes (sibling of
 * `create-ontology-rollback.ts`). The dispatch that removes the row also sets the
 * store's `dirty` flag, which permanently disables the seed effect — so a refused
 * delete leaves the row live server-side, gone locally, and unreachable by any
 * refetch until the next mount.
 *
 * The undo MERGES the removed slice into current state, never reinstates the
 * pre-delete snapshot wholesale: several writes can be in flight, and a wholesale
 * revert drops edits made during the round trip — including one whose debounced
 * PATCH hasn't fired, which would then persist the reverted value.
 */

import { ontologyObjectIds, type GraphAction, type GraphState } from "./graph-state";
import type { Ontology, OntologyObject, OntologySnapshot } from "./types";

/**
 * The state to restore after a failed delete, or `null` when `action` is not
 * a delete or its target was already absent from `before` (nothing to undo).
 *
 * @param before state as it was when the delete was dispatched
 * @param current state now — the failed delete's removal plus anything that
 *   landed during the round trip
 */
export function planDeleteRollback(
  before: GraphState,
  current: GraphState,
  action: GraphAction
): OntologySnapshot | null {
  if (action.type !== "OBJECT_DELETE" && action.type !== "ONTOLOGY_DELETE") return null;

  const removedOntology: Ontology | null =
    action.type === "ONTOLOGY_DELETE"
      ? (before.ontologies.find((c) => c.id === action.id) ?? null)
      : null;
  if (action.type === "ONTOLOGY_DELETE" && !removedOntology) return null;
  if (action.type === "OBJECT_DELETE" && !before.objects[action.id]) return null;

  const removed = new Set(
    action.type === "OBJECT_DELETE" ? [action.id] : ontologyObjectIds(before, action.id)
  );

  return {
    objects: restoreObjects(before, current, removed),
    ontologies: restoreOntologies(before, current, removed, removedOntology),
  };
}

/**
 * Puts deleted objects back and un-scrubs the containment/relationship refs the
 * delete stripped from survivors. Every other field on a survivor comes from
 * `current`, so an edit made during the round trip survives the rollback.
 */
function restoreObjects(
  before: GraphState,
  current: GraphState,
  removed: ReadonlySet<string>
): Record<string, OntologyObject> {
  const objects = { ...current.objects };
  for (const id of removed) {
    const was = before.objects[id];
    if (was && !objects[id]) objects[id] = was;
  }
  for (const [id, was] of Object.entries(before.objects)) {
    const now = objects[id];
    if (removed.has(id) || !now) continue;
    const referenced =
      was.childIds.some((childId) => removed.has(childId)) ||
      was.relationships.some((r) => r.targetIds.some((t) => removed.has(t)));
    if (!referenced) continue;
    objects[id] = { ...now, childIds: was.childIds, relationships: was.relationships };
  }
  return objects;
}

/**
 * Restores `columnIds` on ontologies an object delete pruned, and re-inserts a
 * deleted ontology at its original index — a failed delete must not reorder the
 * tab strip.
 */
function restoreOntologies(
  before: GraphState,
  current: GraphState,
  removed: ReadonlySet<string>,
  removedOntology: Ontology | null
): Ontology[] {
  const ontologies = current.ontologies.map((c) => {
    const was = before.ontologies.find((b) => b.id === c.id);
    if (!was || !was.columnIds.some((id) => removed.has(id))) return c;
    return { ...c, columnIds: was.columnIds };
  });
  if (!removedOntology || ontologies.some((c) => c.id === removedOntology.id)) return ontologies;
  const at = before.ontologies.findIndex((c) => c.id === removedOntology.id);
  const index = at === -1 ? ontologies.length : Math.min(at, ontologies.length);
  return [...ontologies.slice(0, index), removedOntology, ...ontologies.slice(index)];
}
