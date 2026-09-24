/**
 * SERVER-half rollback decision for `createClusterOptimistic` partial failures
 * (F-031). The create runs three sequential POSTs (cluster → seed column → seed
 * card); the LOCAL half needs no decision (one cascading `CLUSTER_DELETE`).
 * Server half: a failure AFTER the cluster POST leaves a real seedless cluster
 * row to delete; a failure ON it created nothing to undo.
 */

export type ClusterCreateRollbackPlan =
  | { rollback: false }
  | { rollback: true; clusterId: string };

/**
 * @param createdClusterId id of the cluster the first POST created, or `null`
 *   when the cluster POST itself failed (nothing to undo).
 */
export function planClusterCreateRollback(
  createdClusterId: string | null
): ClusterCreateRollbackPlan {
  return createdClusterId === null
    ? { rollback: false }
    : { rollback: true, clusterId: createdClusterId };
}
