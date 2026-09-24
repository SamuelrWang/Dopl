/**
 * Invariant suite — optimistic-delete rollback. A refused delete restores the object
 * (or whole ontology cascade), the scrubbed references and the ontology's original tab
 * index, but must not undo anything that landed during the round trip: a wholesale
 * revert persists stale text on the next debounced PATCH.
 */

import { describe, it, expect } from "vitest";
import { graphReducer, type GraphState } from "./graph-state";
import { planDeleteRollback } from "./delete-rollback";
import type { Ontology, OntologyObject } from "./types";

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
    makeObject("card3", {
      childIds: ["card1"],
      relationships: [
        { label: "refs", targetIds: ["card1", "colB"] },
        { label: "only-removed", targetIds: ["sub1"] },
      ],
    }),
  ];
  return {
    ontologies: [makeOntology("A", ["colA"]), makeOntology("B", ["colB"]), makeOntology("C", [])],
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
  };
}

/** What the store does: dispatch, fail, roll back. */
function deleteThenRollback(action: { type: "OBJECT_DELETE" | "ONTOLOGY_DELETE"; id: string }) {
  const before = makeState();
  const after = graphReducer(before, action);
  return { before, after, rolled: planDeleteRollback(before, after, action) };
}

describe("planDeleteRollback — ontology delete", () => {
  it("restores the ontology, its cascade, and the scrubbed references", () => {
    const { before, rolled } = deleteThenRollback({ type: "ONTOLOGY_DELETE", id: "A" });
    expect(rolled).not.toBeNull();
    expect(rolled?.ontologies).toEqual(before.ontologies);
    expect(rolled?.objects).toEqual(before.objects);
  });

  it("puts the ontology back at its original tab index", () => {
    const { rolled } = deleteThenRollback({ type: "ONTOLOGY_DELETE", id: "B" });
    expect(rolled?.ontologies.map((c) => c.id)).toEqual(["A", "B", "C"]);
  });

  it("keeps edits made during the failed round trip", () => {
    const before = makeState();
    const deleted = graphReducer(before, { type: "ONTOLOGY_DELETE", id: "A" });
    // Landed mid-DELETE: a rename on a surviving object and on an ontology.
    const current = graphReducer(
      graphReducer(deleted, {
        type: "OBJECT_UPDATE",
        id: "card3",
        patch: { name: "renamed" },
      }),
      { type: "ONTOLOGY_UPDATE", id: "B", patch: { name: "Renamed B" } }
    );

    const rolled = planDeleteRollback(before, current, { type: "ONTOLOGY_DELETE", id: "A" });

    expect(rolled?.objects.card3.name).toBe("renamed");
    expect(rolled?.ontologies.find((c) => c.id === "B")?.name).toBe("Renamed B");
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
      graphReducer(before, { type: "ONTOLOGY_DELETE", id: "A" }),
      { type: "ONTOLOGY_DELETE", id: "B" }
    );

    const rolled = planDeleteRollback(before, current, { type: "ONTOLOGY_DELETE", id: "A" });

    expect(rolled?.ontologies.map((c) => c.id)).toEqual(["A", "C"]);
    expect(rolled?.objects.colB).toBeUndefined();
    expect(rolled?.objects.colA).toBeDefined();
  });

  it("is null for an ontology that was already gone before the dispatch", () => {
    const before = makeState();
    expect(
      planDeleteRollback(before, before, { type: "ONTOLOGY_DELETE", id: "nope" })
    ).toBeNull();
  });
});

describe("planDeleteRollback — object delete", () => {
  it("restores the object and every reference to it", () => {
    const { before, rolled } = deleteThenRollback({ type: "OBJECT_DELETE", id: "card1" });
    expect(rolled?.objects).toEqual(before.objects);
    expect(rolled?.ontologies).toEqual(before.ontologies);
  });

  it("restores a deleted column onto its ontology", () => {
    const { rolled } = deleteThenRollback({ type: "OBJECT_DELETE", id: "colA" });
    expect(rolled?.ontologies.find((c) => c.id === "A")?.columnIds).toEqual(["colA"]);
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
