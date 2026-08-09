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
import { graphReducer, orphanedByObjectDelete, type GraphState } from "./graph-state";
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

/**
 * INVARIANT SUITE — orphanedByObjectDelete mirrors `cascade_hard_delete_object`.
 *
 * The count this returns is what the confirm dialog shows before a permanent
 * delete, so an over-count scares the user off a safe action and an under-count
 * destroys work they were never warned about. The rule is MEMBERSHIP, not
 * depth: a descendant that still hangs under a surviving parent lives on the
 * board that holds it. `makeState`'s `card1` is exactly that case — a child of
 * both `colA` (cluster A) and `card3` (cluster B).
 */
/**
 * INVARIANT SUITE — CREATE_RESOLVE rewrites every place an id is named.
 *
 * A provisional id left behind anywhere is a dangling reference the user only
 * discovers on the next load: a column whose cluster no longer lists it, an
 * edge pointing at nothing, a `ref` attribute that renders blank. The rewrite
 * is therefore total, not "the links of the row that was just created".
 */
describe("CREATE_RESOLVE", () => {
  function pendingState(): GraphState {
    return {
      clusters: [
        {
          ...makeCluster("p:cluster", ["p:col"]),
          // Dragged positions are keyed by OBJECT id — the id-keyed structure
          // that holds no id-shaped field, and so the one a rewrite skips.
          layout: { "p:col": { x: 40, y: 80 }, live: { x: 1, y: 2 } },
        },
      ],
      objects: {
        "p:col": makeObject("p:col", { childIds: ["p:card"] }),
        "p:card": makeObject("p:card"),
        live: makeObject("live", {
          childIds: ["p:card"],
          relationships: [{ label: "refs", targetIds: ["p:card", "other"] }],
          attributes: [
            { key: "k", label: "K", value: { kind: "ref", value: ["p:col", "other"] } },
            { key: "t", label: "T", value: { kind: "text", value: "p:col" } },
          ],
        }),
      },
    };
  }

  const RESOLVE = {
    type: "CREATE_RESOLVE",
    map: { "p:cluster": "cluster-1", "p:col": "col-1", "p:card": "card-1" },
    slugs: { "cluster-1": "revenue" },
  } as const;

  it("re-keys the objects map and every id inside the rows", () => {
    const next = graphReducer(pendingState(), RESOLVE);
    expect(Object.keys(next.objects).sort()).toEqual(["card-1", "col-1", "live"]);
    expect(next.objects["col-1"].id).toBe("col-1");
    expect(next.objects["col-1"].childIds).toEqual(["card-1"]);
    expect(next.clusters[0].id).toBe("cluster-1");
    expect(next.clusters[0].columnIds).toEqual(["col-1"]);
  });

  it("folds in the server's slug, keyed by the REAL cluster id", () => {
    expect(graphReducer(pendingState(), RESOLVE).clusters[0].slug).toBe("revenue");
    // No slug for that cluster: whatever it already had survives untouched.
    const noSlug = graphReducer(pendingState(), { type: "CREATE_RESOLVE", map: RESOLVE.map });
    expect(noSlug.clusters[0].slug).toBe("p:cluster");
  });

  it("rewrites references held by OTHER rows — edges and ref attributes", () => {
    const live = graphReducer(pendingState(), RESOLVE).objects.live;
    expect(live.childIds).toEqual(["card-1"]);
    expect(live.relationships).toEqual([{ label: "refs", targetIds: ["card-1", "other"] }]);
    expect(live.attributes[0].value).toEqual({ kind: "ref", value: ["col-1", "other"] });
    // A text value that merely LOOKS like an id is content, not a reference.
    expect(live.attributes[1].value).toEqual({ kind: "text", value: "p:col" });
  });

  it("remaps the cluster layout's KEYS, positions preserved", () => {
    const { layout } = graphReducer(pendingState(), RESOLVE).clusters[0];
    expect(Object.keys(layout).sort()).toEqual(["col-1", "live"]);
    // The position itself is untouched — this is a rename, not a re-layout.
    expect(layout["col-1"]).toEqual({ x: 40, y: 80 });
    expect(layout.live).toEqual({ x: 1, y: 2 });
    // Nothing provisional survives as a key: that leftover is the orphan that
    // would ride back to `clusters.layout` on the next drag write.
    expect(Object.keys(layout).some((id) => id.startsWith("p:"))).toBe(false);
  });

  it("does not mutate the input state, and no-ops on an empty map", () => {
    const state = pendingState();
    graphReducer(state, RESOLVE);
    expect(state.objects["p:col"].childIds).toEqual(["p:card"]);
    expect(Object.keys(state.clusters[0].layout).sort()).toEqual(["live", "p:col"]);
    expect(graphReducer(state, { type: "CREATE_RESOLVE", map: {} })).toBe(state);
  });
});

describe("orphanedByObjectDelete", () => {
  it("orphans only the descendants with no surviving parent", () => {
    // colA owns card1 + card2. card2 has nowhere else to live; card1 also
    // hangs under card3, so it survives — and so does its own child sub1.
    expect(orphanedByObjectDelete(makeState(), "colA")).toEqual(["card2"]);
  });

  it("returns nothing when every child is shared with a survivor", () => {
    expect(orphanedByObjectDelete(makeState(), "card3")).toEqual([]);
  });

  it("cascades through a chain when each link is only reachable one way", () => {
    expect(orphanedByObjectDelete(makeState(), "card1")).toEqual(["sub1"]);
  });

  it("excludes the target itself and no-ops on an unknown id", () => {
    expect(orphanedByObjectDelete(makeState(), "card2")).toEqual([]);
    expect(orphanedByObjectDelete(makeState(), "nope")).toEqual([]);
  });
});
