/**
 * Invariant suite: ONTOLOGY_DELETE cascade contract. Deleting an ontology removes its
 * columns + nested cards and scrubs dangling childIds / relationship targetIds off
 * objects surviving in other ontologies.
 */

import { describe, it, expect } from "vitest";
import { graphReducer, orphanedByObjectDelete, type GraphState } from "./graph-state";
import { ontologyListRows } from "./hooks/use-ontologies";
import type { Ontology, OntologyObject, OntologySnapshot } from "./types";

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

function makeOntology(id: string, columnIds: string[]): Ontology {
  return { id, slug: id, name: id, purpose: "", columnIds, layout: {} };
}

function makeState(): GraphState {
  const objects = [
    makeObject("colA", { childIds: ["card1", "card2"] }),
    makeObject("card1", { childIds: ["sub1"] }),
    makeObject("sub1"),
    makeObject("card2"),
    makeObject("colB", { childIds: ["card3"] }),
    // card3 (ontology B) references ontology-A objects: shared child card1 and
    // two edges — one keeps a surviving target, one empties and is dropped.
    makeObject("card3", {
      childIds: ["card1"],
      relationships: [
        { label: "refs", targetIds: ["card1", "colB"] },
        { label: "only-removed", targetIds: ["sub1"] },
      ],
    }),
  ];
  return {
    ontologies: [makeOntology("A", ["colA"]), makeOntology("B", ["colB"])],
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
  };
}

describe("ONTOLOGY_DELETE", () => {
  it("removes the ontology, its columns, and all nested descendants", () => {
    const next = graphReducer(makeState(), { type: "ONTOLOGY_DELETE", id: "A" });
    expect(next.ontologies.map((c) => c.id)).toEqual(["B"]);
    expect(next.objects.colA).toBeUndefined();
    expect(next.objects.card1).toBeUndefined();
    expect(next.objects.sub1).toBeUndefined();
    expect(next.objects.card2).toBeUndefined();
  });

  it("prunes dangling childIds and relationships from surviving objects", () => {
    const next = graphReducer(makeState(), { type: "ONTOLOGY_DELETE", id: "A" });
    expect(next.objects.card3.childIds).toEqual([]);
    expect(next.objects.card3.relationships).toEqual([
      { label: "refs", targetIds: ["colB"] },
    ]);
  });

  it("leaves other ontologies and their objects untouched", () => {
    const next = graphReducer(makeState(), { type: "ONTOLOGY_DELETE", id: "A" });
    const ontologyB = next.ontologies.find((c) => c.id === "B");
    expect(ontologyB?.columnIds).toEqual(["colB"]);
    expect(next.objects.colB).toEqual(makeObject("colB", { childIds: ["card3"] }));
  });

  it("does not mutate the input state", () => {
    const state = makeState();
    graphReducer(state, { type: "ONTOLOGY_DELETE", id: "A" });
    expect(state.ontologies.map((c) => c.id)).toEqual(["A", "B"]);
    expect(state.objects.card3.childIds).toEqual(["card1"]);
    expect(state.objects.card1).toBeDefined();
  });

  it("is a no-op on an unknown ontology id", () => {
    const state = makeState();
    const next = graphReducer(state, { type: "ONTOLOGY_DELETE", id: "does-not-exist" });
    expect(next).toBe(state);
  });
});

/**
 * CREATE_RESOLVE rewrites every place an id is named — total, not just the created
 * row's links: a leftover provisional id is a dangling reference the user only
 * discovers on the next load.
 */
describe("CREATE_RESOLVE", () => {
  function pendingState(): GraphState {
    return {
      ontologies: [
        {
          ...makeOntology("p:ontology", ["p:col"]),
          // Dragged positions keyed by object id — the structure a rewrite skips.
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
    map: { "p:ontology": "ontology-1", "p:col": "col-1", "p:card": "card-1" },
    slugs: { "ontology-1": "revenue" },
  } as const;

  it("re-keys the objects map and every id inside the rows", () => {
    const next = graphReducer(pendingState(), RESOLVE);
    expect(Object.keys(next.objects).sort()).toEqual(["card-1", "col-1", "live"]);
    expect(next.objects["col-1"].id).toBe("col-1");
    expect(next.objects["col-1"].childIds).toEqual(["card-1"]);
    expect(next.ontologies[0].id).toBe("ontology-1");
    expect(next.ontologies[0].columnIds).toEqual(["col-1"]);
  });

  it("folds in the server's slug, keyed by the REAL ontology id", () => {
    expect(graphReducer(pendingState(), RESOLVE).ontologies[0].slug).toBe("revenue");
    const noSlug = graphReducer(pendingState(), { type: "CREATE_RESOLVE", map: RESOLVE.map });
    expect(noSlug.ontologies[0].slug).toBe("p:ontology");
  });

  it("rewrites references held by OTHER rows — edges and ref attributes", () => {
    const live = graphReducer(pendingState(), RESOLVE).objects.live;
    expect(live.childIds).toEqual(["card-1"]);
    expect(live.relationships).toEqual([{ label: "refs", targetIds: ["card-1", "other"] }]);
    expect(live.attributes[0].value).toEqual({ kind: "ref", value: ["col-1", "other"] });
    // A text value that looks like an id is content, not a reference.
    expect(live.attributes[1].value).toEqual({ kind: "text", value: "p:col" });
  });

  it("remaps the ontology layout's KEYS, positions preserved", () => {
    const { layout } = graphReducer(pendingState(), RESOLVE).ontologies[0];
    expect(Object.keys(layout).sort()).toEqual(["col-1", "live"]);
    expect(layout["col-1"]).toEqual({ x: 40, y: 80 });
    expect(layout.live).toEqual({ x: 1, y: 2 });
    // A leftover provisional key rides back to `ontologies.layout` on next drag.
    expect(Object.keys(layout).some((id) => id.startsWith("p:"))).toBe(false);
  });

  it("does not mutate the input state, and no-ops on an empty map", () => {
    const state = pendingState();
    graphReducer(state, RESOLVE);
    expect(state.objects["p:col"].childIds).toEqual(["p:card"]);
    expect(Object.keys(state.ontologies[0].layout).sort()).toEqual(["live", "p:col"]);
    expect(graphReducer(state, { type: "CREATE_RESOLVE", map: {} })).toBe(state);
  });
});

describe("orphanedByObjectDelete", () => {
  it("orphans only the descendants with no surviving parent", () => {
    // card2 has nowhere else to live; card1 also hangs under card3 so it
    // survives, and so does its child sub1.
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

describe("a snapshot persisted before the 2026-09-23 key rename (INVARIANTS §8 stale cache)", () => {
  // The persisted query cache restores the OLD shape before the first refetch: the list sits
  // under the retired key, and `ontologies` is absent. It must read as empty, never throw.
  const stale = { objects: {} } as unknown as OntologySnapshot;

  it("SNAPSHOT_SET reads an absent list as empty", () => {
    const next = graphReducer({ ontologies: [], objects: {} }, { type: "SNAPSHOT_SET", snapshot: stale });
    expect(next.ontologies).toEqual([]);
  });

  it("the list rows read an absent list as empty", () => {
    expect(ontologyListRows(stale)).toEqual([]);
  });
});
