/**
 * Unit — createCluster partial-failure rollback decision (F-031). Cluster POST
 * fires first, so a later failure leaves an orphan cluster to undo; a
 * first-POST failure created nothing.
 */

import { describe, it, expect } from "vitest";
import { planClusterCreateRollback } from "./create-cluster-rollback";

describe("planClusterCreateRollback", () => {
  it("rolls back the orphan cluster when the cluster POST succeeded", () => {
    expect(planClusterCreateRollback("cluster-123")).toEqual({
      rollback: true,
      clusterId: "cluster-123",
    });
  });

  it("does nothing when the cluster POST itself failed", () => {
    expect(planClusterCreateRollback(null)).toEqual({ rollback: false });
  });
});
