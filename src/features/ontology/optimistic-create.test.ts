/**
 * Invariant suite: ontology create order, and what a failure puts back. The
 * assertion is WHEN, not whether — reducer state is snapshotted inside the
 * transport (at the instant each request leaves), and the tab + column + first
 * card must already be there in the first one. Runs against the real
 * `graphReducer`, so rollbacks are checked as board states, not dispatch logs.
 *
 * The draft lane ("+ Object") is its own file, `optimistic-create-draft.test.ts`;
 * both drive the one harness in `optimistic-create-harness.ts`.
 */

import { describe, expect, it } from "vitest";
import { EMPTY_GRAPH, type GraphState } from "./graph-state";
import {
  createOntologyOptimistic,
  createObjectOptimistic,
  isPendingOntologyId,
  NEW_CARD_NAME,
  NEW_ONTOLOGY_NAME,
  NEW_COLUMN_NAME,
} from "./optimistic-create";
import {
  flush,
  harness,
  savedOntology,
  savedObject,
  seededOf,
} from "./optimistic-create-harness";

describe("createOntologyOptimistic — ordering", () => {
  it("has the tab, its column and its first card on the board before the first POST leaves", () => {
    const h = harness();
    const { row } = createOntologyOptimistic(h.api, h.sink);

    expect(h.sent).toHaveLength(1);
    const atSubmit = h.sent[0]!.board;
    expect(atSubmit.ontologies.map((c) => c.id)).toEqual([row.id]);
    const { column, card } = seededOf(atSubmit, row);
    expect(column.name).toBe(NEW_COLUMN_NAME);
    expect(card.name).toBe(NEW_CARD_NAME);
    expect(row.name).toBe(NEW_ONTOLOGY_NAME);
  });

  it("marks all three rows pending, and holds the write gate open, from the click", () => {
    const h = harness();
    const { row } = createOntologyOptimistic(h.api, h.sink);
    const { column, card } = seededOf(h.board, row);

    expect([...h.pending].sort()).toEqual([row.id, column.id, card.id].sort());
    expect([...h.pending].every(isPendingOntologyId)).toBe(true);
    expect(h.writesInFlight).toBe(1);
    // The gate opens before the request, or a realtime snapshot arriving in the
    // same tick could re-seed the reducer over rows that have no server row yet.
    expect(h.order).toEqual([
      "markPending",
      "ONTOLOGY_ADD",
      "OBJECT_ADD",
      "OBJECT_ADD",
      "beginWrite",
    ]);
  });

  it("runs the seed POSTs against the ids the server minted, in order", async () => {
    const h = harness();
    createOntologyOptimistic(h.api, h.sink);

    h.ontologyCalls[0]!.settle(savedOntology());
    await flush();
    expect(h.sent[1]).toMatchObject({
      op: "createObject",
      input: { ontologyId: "ontology-real", name: NEW_COLUMN_NAME },
    });

    h.objectCalls[0]!.settle(savedObject("column-real"));
    await flush();
    expect(h.sent[2]).toMatchObject({
      op: "createObject",
      input: { parentObjectId: "column-real", name: NEW_CARD_NAME },
    });
  });
});

describe("createOntologyOptimistic — resolve", () => {
  it("swaps every provisional id for the real one and folds in the server slug", async () => {
    const h = harness();
    const { row, done } = createOntologyOptimistic(h.api, h.sink);
    const { column, card } = seededOf(h.board, row);

    h.ontologyCalls[0]!.settle(savedOntology());
    await flush();
    h.objectCalls[0]!.settle(savedObject("column-real"));
    await flush();
    h.objectCalls[1]!.settle(savedObject("card-real"));
    await done;

    const ontology = h.board.ontologies[0]!;
    expect(ontology.id).toBe("ontology-real");
    // Slug is server-minted; optimistic ontology has none.
    expect(ontology.slug).toBe("new-ontology");
    expect(ontology.columnIds).toEqual(["column-real"]);
    expect(h.board.objects["column-real"]!.childIds).toEqual(["card-real"]);
    for (const gone of [row.id, column.id, card.id]) {
      expect(h.board.objects[gone]).toBeUndefined();
    }
    expect(Object.keys(h.board.objects).some(isPendingOntologyId)).toBe(false);
  });

  it("clears pending only AFTER the swap, and releases the gate once", async () => {
    const h = harness();
    const { done } = createOntologyOptimistic(h.api, h.sink);

    h.ontologyCalls[0]!.settle(savedOntology());
    await flush();
    h.objectCalls[0]!.settle(savedObject("column-real"));
    await flush();
    h.objectCalls[1]!.settle(savedObject("card-real"));
    await done;

    // Un-dimming before the id is real invites a write that 404s.
    expect(h.order.indexOf("resolve")).toBeLessThan(h.order.indexOf("clearPending"));
    expect(h.pending.size).toBe(0);
    expect(h.writesInFlight).toBe(0);
    expect(h.writeEnds).toBe(1);
    expect(h.createdCount).toBe(1);
    expect(h.failures).toEqual([]);
  });
});

describe("createOntologyOptimistic — rollback", () => {
  it("takes the whole optimistic ontology back off the board when a seed POST fails", async () => {
    const h = harness();
    const { done } = createOntologyOptimistic(h.api, h.sink);

    h.ontologyCalls[0]!.settle(savedOntology());
    await flush();
    const boom = new Error("seed column refused");
    h.objectCalls[0]!.fail(boom);
    expect(await done).toBeNull();

    // Column + card go with the ontology, else a ghost tab survives (F-031).
    expect(h.board).toEqual(EMPTY_GRAPH);
    expect(h.deletedOntologies).toEqual(["ontology-real"]);
    expect(h.failures).toEqual([{ what: "create ontology", err: boom }]);
    expect(h.pending.size).toBe(0);
    expect(h.writesInFlight).toBe(0);
    expect(h.writeEnds).toBe(1);
    expect(h.createdCount).toBe(0);
  });

  it("deletes nothing server-side when the ontology POST itself fails", async () => {
    const h = harness();
    const { done } = createOntologyOptimistic(h.api, h.sink);

    h.ontologyCalls[0]!.fail(new Error("nope"));
    expect(await done).toBeNull();

    expect(h.board).toEqual(EMPTY_GRAPH);
    expect(h.deletedOntologies).toEqual([]);
    expect(h.sent).toHaveLength(1);
  });

  it("leaves a board that already had ontologies exactly as it found it", async () => {
    const h = harness();
    const existing: GraphState = {
      ontologies: [savedOntology({ id: "c1", slug: "c1", columnIds: ["col1"] })],
      objects: { col1: savedObject("col1", { name: "Accounts" }) },
    };
    h.seed(existing);
    const { done } = createOntologyOptimistic(h.api, h.sink);

    h.ontologyCalls[0]!.fail(new Error("nope"));
    await done;

    expect(h.board).toEqual(existing);
  });
});

describe("createObjectOptimistic", () => {
  const column = savedObject("col1", {
    name: "Accounts",
    template: [
      { key: "owner", label: "Owner", kind: "text" },
      { key: "docs", label: "Docs", kind: "knowledge" },
    ],
    methods: [{ name: "Follow up", description: "", outcome: "", tools: "" }],
    relationships: [{ label: "member of", targetIds: ["col1"] }],
  });
  const board: GraphState = {
    ontologies: [savedOntology({ id: "c1", slug: "c1", columnIds: ["col1"] })],
    objects: { col1: column },
  };

  it("puts the card in its lane before the POST leaves, born from the column's template", () => {
    const h = harness();
    h.seed(board);
    const { row } = createObjectOptimistic(
      h.api,
      h.sink,
      { parentObjectId: "col1" },
      column
    );

    expect(h.sent).toHaveLength(1);
    const atSubmit = h.sent[0]!.board;
    expect(atSubmit.objects.col1!.childIds).toEqual([row.id]);
    // Columns are templates server-side → pending card renders complete.
    expect(row.attributes).toEqual([
      { key: "owner", label: "Owner", value: { kind: "text", value: "" } },
      { key: "docs", label: "Docs", value: { kind: "knowledge", value: [] } },
    ]);
    expect(row.methods).toEqual(column.methods);
    expect(row.relationships).toEqual(column.relationships);
    expect(h.pending.has(row.id)).toBe(true);
  });

  it("adds a column straight to the ontology, with no inherited template", () => {
    const h = harness();
    h.seed(board);
    const { row } = createObjectOptimistic(h.api, h.sink, { ontologyId: "c1" });

    expect(h.sent[0]!.board.ontologies[0]!.columnIds).toEqual(["col1", row.id]);
    expect(row.name).toBe(NEW_COLUMN_NAME);
    expect(row.attributes).toEqual([]);
  });

  it("swaps the provisional id when the POST answers", async () => {
    const h = harness();
    h.seed(board);
    const { row, done } = createObjectOptimistic(
      h.api,
      h.sink,
      { parentObjectId: "col1" },
      column
    );

    h.objectCalls[0]!.settle(savedObject("card-real"));
    await done;

    expect(h.board.objects.col1!.childIds).toEqual(["card-real"]);
    expect(h.board.objects[row.id]).toBeUndefined();
    expect(h.pending.size).toBe(0);
    expect(h.createdCount).toBe(1);
  });

  it("removes the card and releases the gate when the POST fails", async () => {
    const h = harness();
    h.seed(board);
    const { done } = createObjectOptimistic(h.api, h.sink, { parentObjectId: "col1" }, column);

    const boom = new Error("refused");
    h.objectCalls[0]!.fail(boom);
    expect(await done).toBeNull();

    expect(h.board).toEqual(board);
    expect(h.failures).toEqual([{ what: "create object", err: boom }]);
    expect(h.pending.size).toBe(0);
    expect(h.writesInFlight).toBe(0);
    expect(h.writeEnds).toBe(1);
  });
});
