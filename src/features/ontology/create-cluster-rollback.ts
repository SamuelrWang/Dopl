/**
 * SERVER-half rollback decision for `createClusterOptimistic` partial failures
 * (F-031).
 *
 * The create runs three sequential POSTs (cluster → seed column → seed card).
 * Since the optimistic reordering (2026-08-08) the LOCAL half needs no
 * decision — the cluster, column and card are dispatched before the first POST
 * leaves, so any failure removes them with one `CLUSTER_DELETE` that cascades.
 * What still needs deciding is the server half: a failure AFTER the cluster
 * POST leaves a real, seedless cluster row behind that must be deleted, while a
 * failure ON the cluster POST created nothing to undo. Pulled out as a pure
 * function so the guard has direct unit coverage.
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
