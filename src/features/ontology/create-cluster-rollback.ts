/**
 * Rollback decision for `useOntology().createCluster` partial failures (F-031).
 *
 * `createCluster` runs three sequential POSTs (cluster → seed column → seed
 * card) and dispatches CLUSTER_ADD right after the cluster POST resolves. If a
 * later POST throws, the cluster already exists both in local state and on the
 * server with no seed column/card — an orphan that must be rolled back. A
 * failure on the cluster POST itself created nothing, so there is nothing to
 * undo. Pulled out as a pure function so the guard has direct unit coverage.
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
