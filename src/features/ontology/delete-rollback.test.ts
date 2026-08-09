/**
 * INVARIANT SUITE — optimistic-delete rollback.
 *
 * A delete the server refuses must leave the board exactly as it was before
 * the dispatch: the object (or the whole cluster cascade) back, the references
 * the cascade scrubbed off surviving objects back, and the cluster at its
 * ORIGINAL tab index. It must NOT undo anything that happened during the
 * failed request's round trip — the store keeps several writes in flight and a
 * wholesale revert to the pre-delete snapshot would persist stale text on the
 * next debounced PATCH.
 */

import { describe, it, expect } from "vitest";
import { graphReducer, type GraphState } from "./graph-state";
import { planDeleteRollback } from "./delete-rollback";
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
    makeObject("card3", {
      childIds: ["card1"],
      relationships: [
        { label: "refs", targetIds: ["card1", "colB"] },
        { label: "only-removed", targetIds: ["sub1"] },
      ],
    }),
  ];
  return {
    clusters: [makeCluster("A", ["colA"]), makeCluster("B", ["colB"]), makeCluster("C", [])],
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
  };
}

/** What the store does: dispatch, fail, roll back. */
function deleteThenRollback(action: { type: "OBJECT_DELETE" | "CLUSTER_DELETE"; id: string }) {
  const before = makeState();
  const after = graphReducer(before, action);
  return { before, after, rolled: planDeleteRollback(before, after, action) };
}

describe("planDeleteRollback — cluster delete", () => {
  it("restores the cluster, its cascade, and the scrubbed references", () => {
    const { before, rolled } = deleteThenRollback({ type: "CLUSTER_DELETE", id: "A" });
    expect(rolled).not.toBeNull();
    expect(rolled?.clusters).toEqual(before.clusters);
    expect(rolled?.objects).toEqual(before.objects);
  });

  it("puts the cluster back at its original tab index", () => {
    const { rolled } = deleteThenRollback({ type: "CLUSTER_DELETE", id: "B" });
    expect(rolled?.clusters.map((c) => c.id)).toEqual(["A", "B", "C"]);
  });

  it("keeps edits made during the failed round trip", () => {
    const before = makeState();
    const deleted = graphReducer(before, { type: "CLUSTER_DELETE", id: "A" });
    // Two things landed while the DELETE was in flight: a rename on a
    // surviving object, and a rename on a surviving cluster.
    const current = graphReducer(
      graphReducer(deleted, {
        type: "OBJECT_UPDATE",
        id: "card3",
        patch: { name: "renamed" },
      }),
      { type: "CLUSTER_UPDATE", id: "B", patch: { name: "Renamed B" } }
    );

    const rolled = planDeleteRollback(before, current, { type: "CLUSTER_DELETE", id: "A" });

    expect(rolled?.objects.card3.name).toBe("renamed");
    expect(rolled?.clusters.find((c) => c.id === "B")?.name).toBe("Renamed B");
    // …and the cascade still came back, references included.
    expect(rolled?.objects.card1).toBeDefined();
    expect(rolled?.objects.sub1).toBeDefined();
    expect(rolled?.objects.card3.childIds).toEqual(["card1"]);
    expect(rolled?.objects.card3.relationships).toEqual(
      before.objects.card3.relationships
    );
  });

  it("does not resurrect a DIFFERENT delete that succeeded in the meantime", () => {
    const before = makeState();
    const current = graphReducer(
      graphReducer(before, { type: "CLUSTER_DELETE", id: "A" }),
      { type: "CLUSTER_DELETE", id: "B" }
    );

    const rolled = planDeleteRollback(before, current, { type: "CLUSTER_DELETE", id: "A" });

    expect(rolled?.clusters.map((c) => c.id)).toEqual(["A", "C"]);
    expect(rolled?.objects.colB).toBeUndefined();
    expect(rolled?.objects.colA).toBeDefined();
  });

  it("is null for a cluster that was already gone before the dispatch", () => {
    const before = makeState();
    expect(
      planDeleteRollback(before, before, { type: "CLUSTER_DELETE", id: "nope" })
    ).toBeNull();
  });
});

describe("planDeleteRollback — object delete", () => {
  it("restores the object and every reference to it", () => {
    const { before, rolled } = deleteThenRollback({ type: "OBJECT_DELETE", id: "card1" });
    expect(rolled?.objects).toEqual(before.objects);
    expect(rolled?.clusters).toEqual(before.clusters);
  });

  it("restores a deleted column onto its cluster", () => {
    const { rolled } = deleteThenRollback({ type: "OBJECT_DELETE", id: "colA" });
    expect(rolled?.clusters.find((c) => c.id === "A")?.columnIds).toEqual(["colA"]);
    expect(rolled?.objects.colA).toBeDefined();
  });

  it("is null for an unknown object id", () => {
    const before = makeState();
    expect(
      planDeleteRollback(before, before, { type: "OBJECT_DELETE", id: "nope" })
    ).toBeNull();
  });

  it("is null for a non-delete action", () => {
    const before = makeState();
    expect(
      planDeleteRollback(before, before, {
        type: "OBJECT_UPDATE",
        id: "card1",
        patch: { name: "x" },
      })
    ).toBeNull();
  });
});
