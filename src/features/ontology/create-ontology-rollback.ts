/**
 * SERVER-half rollback decision for `createOntologyOptimistic` partial failures
 * (F-031). The create runs three sequential POSTs (ontology → seed column → seed
 * card); the LOCAL half needs no decision (one cascading `ONTOLOGY_DELETE`).
 * Server half: a failure AFTER the ontology POST leaves a real seedless ontology
 * row to delete; a failure ON it created nothing to undo.
 */

export type OntologyCreateRollbackPlan =
  | { rollback: false }
  | { rollback: true; ontologyId: string };

/**
 * @param createdOntologyId id of the ontology the first POST created, or `null`
 *   when the ontology POST itself failed (nothing to undo).
 */
export function planOntologyCreateRollback(
  createdOntologyId: string | null
): OntologyCreateRollbackPlan {
  return createdOntologyId === null
    ? { rollback: false }
    : { rollback: true, ontologyId: createdOntologyId };
}
