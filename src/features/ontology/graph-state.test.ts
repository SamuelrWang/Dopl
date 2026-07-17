/**
 * INVARIANT SUITE — CLUSTER_DELETE cascade contract.
 *
 * A cluster owns its columns and every nested card; deleting it must
 * remove all of them and scrub the dangling references (childIds and
 * relationship targetIds) from objects that survive in OTHER clusters,
 * exactly as OBJECT_DELETE does for a single object — while leaving the
 * other clusters and a no-op unknown id untouched.
 */

import { describe, it, expect } from "vitest";
import { graphReducer, type GraphState } from "./graph-state";
import type { OntologyCluster, OntologyObject } from "./types";

function makeObject(id: string, over: Partial<OntologyObject> = {}): OntologyObject {
  return {
    id,
    name: id,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: [],
    template: [],
    ...over,
  };
}

function makeCluster(id: string, columnIds: string[]): OntologyCluster {
  return { id, slug: id, name: id, purpose: "", columnIds, layout: {} };
}

function makeState(): GraphState {
  const objects = [
    makeObject("colA", { childIds: ["card1", "card2"] }),
    makeObject("card1", { childIds: ["sub1"] }),
    makeObject("sub1"),
    makeObject("card2"),
    makeObject("colB", { childIds: ["card3"] }),
    // card3 lives in cluster B but references cluster-A objects: a shared
    // child (card1) and two edges — one that keeps a surviving target,
    // one that empties out and must be dropped.
    makeObject("card3", {
      childIds: ["card1"],
      relationships: [
        { label: "refs", targetIds: ["card1", "colB"] },
        { label: "only-removed", targetIds: ["sub1"] },
      ],
    }),
  ];
  return {
    clusters: [makeCluster("A", ["colA"]), makeCluster("B", ["colB"])],
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
  };
}

describe("CLUSTER_DELETE", () => {
  it("removes the cluster, its columns, and all nested descendants", () => {
    const next = graphReducer(makeState(), { type: "CLUSTER_DELETE", id: "A" });
    expect(next.clusters.map((c) => c.id)).toEqual(["B"]);
    expect(next.objects.colA).toBeUndefined();
    expect(next.objects.card1).toBeUndefined();
    expect(next.objects.sub1).toBeUndefined();
    expect(next.objects.card2).toBeUndefined();
  });

  it("prunes dangling childIds and relationships from surviving objects", () => {
    const next = graphReducer(makeState(), { type: "CLUSTER_DELETE", id: "A" });
    expect(next.objects.card3.childIds).toEqual([]);
    expect(next.objects.card3.relationships).toEqual([
      { label: "refs", targetIds: ["colB"] },
    ]);
  });

  it("leaves other clusters and their objects untouched", () => {
    const next = graphReducer(makeState(), { type: "CLUSTER_DELETE", id: "A" });
    const clusterB = next.clusters.find((c) => c.id === "B");
    expect(clusterB?.columnIds).toEqual(["colB"]);
    expect(next.objects.colB).toEqual(makeObject("colB", { childIds: ["card3"] }));
  });

  it("does not mutate the input state", () => {
    const state = makeState();
    graphReducer(state, { type: "CLUSTER_DELETE", id: "A" });
    expect(state.clusters.map((c) => c.id)).toEqual(["A", "B"]);
    expect(state.objects.card3.childIds).toEqual(["card1"]);
    expect(state.objects.card1).toBeDefined();
  });

  it("is a no-op on an unknown cluster id", () => {
    const state = makeState();
    const next = graphReducer(state, { type: "CLUSTER_DELETE", id: "does-not-exist" });
    expect(next).toBe(state);
  });
});
