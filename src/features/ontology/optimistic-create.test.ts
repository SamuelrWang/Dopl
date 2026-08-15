/**
 * INVARIANT SUITE — ontology create ORDER, and what a failure puts back.
 *
 * ⚠ The assertion is WHEN, not whether: reducer state is snapshotted INSIDE the
 * transport (at the instant each request leaves), and the tab + column + first
 * card must already be there in the first one. Runs against the REAL
 * `graphReducer`, so rollbacks are checked as board states, not dispatch logs.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_GRAPH,
  graphReducer,
  type GraphAction,
  type GraphState,
} from "./graph-state";
import {
  createClusterOptimistic,
  createObjectOptimistic,
  isPendingOntologyId,
  NEW_CARD_NAME,
  NEW_CLUSTER_NAME,
  NEW_COLUMN_NAME,
  type OntologyCreateApi,
  type OntologyCreateSink,
} from "./optimistic-create";
import type { OntologyCluster, OntologyObject } from "./types";

interface Deferred<T> {
  promise: Promise<T>;
  settle: (value: T) => void;
  fail: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let settle!: (value: T) => void;
  let fail!: (err: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  promise.catch(() => undefined);
  return { promise, settle, fail };
}

/** Drains the microtask queue so an awaited step has actually run. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const savedCluster = (over: Partial<OntologyCluster> = {}): OntologyCluster => ({
  id: "cluster-real",
  slug: "new-cluster",
  name: NEW_CLUSTER_NAME,
  purpose: "",
  columnIds: [],
  layout: {},
  ...over,
});

const savedObject = (id: string, over: Partial<OntologyObject> = {}): OntologyObject => ({
  id,
  name: "",
  subtitle: "",
  attributes: [],
  relationships: [],
  methods: [],
  childIds: [],
  template: [],
  ...over,
});

/** Sink over the real reducer + the transport it drives. Every request records
 *  the board AS IT LEFT — that snapshot is the proof. */
function harness() {
  let state: GraphState = EMPTY_GRAPH;
  const pending = new Set<string>();
  const order: string[] = [];
  const failures: Array<{ what: string; err: unknown }> = [];
  const sent: Array<{ op: string; input: unknown; board: GraphState }> = [];
  const deletedClusters: string[] = [];
  const clusterCalls: Array<Deferred<OntologyCluster>> = [];
  const objectCalls: Array<Deferred<OntologyObject>> = [];
  let writesInFlight = 0;
  let writeEnds = 0;
  let createdCount = 0;

  const record = (op: string, input: unknown) => sent.push({ op, input, board: state });

  const api: OntologyCreateApi = {
    createCluster: (input) => {
      record("createCluster", input);
      const call = deferred<OntologyCluster>();
      clusterCalls.push(call);
      return call.promise;
    },
    createObject: (input) => {
      record("createObject", input);
      const call = deferred<OntologyObject>();
      objectCalls.push(call);
      return call.promise;
    },
    deleteCluster: (clusterId) => {
      deletedClusters.push(clusterId);
      return Promise.resolve();
    },
  };

  const apply = (action: GraphAction) => {
    order.push(action.type);
    state = graphReducer(state, action);
  };

  const sink: OntologyCreateSink = {
    dispatch: apply,
    markPending: (ids) => {
      order.push("markPending");
      for (const id of ids) pending.add(id);
    },
    clearPending: (ids) => {
      order.push("clearPending");
      for (const id of ids) pending.delete(id);
    },
    resolve: (map, slugs) => {
      order.push("resolve");
      apply(slugs ? { type: "CREATE_RESOLVE", map, slugs } : { type: "CREATE_RESOLVE", map });
    },
    beginWrite: () => {
      order.push("beginWrite");
      writesInFlight += 1;
    },
    endWrite: () => {
      order.push("endWrite");
      writesInFlight -= 1;
      writeEnds += 1;
    },
    created: () => {
      createdCount += 1;
    },
    failed: (what, err) => failures.push({ what, err }),
  };

  return {
    api,
    sink,
    order,
    failures,
    sent,
    deletedClusters,
    clusterCalls,
    objectCalls,
    pending,
    seed(next: GraphState) {
      state = next;
    },
    get board() {
      return state;
    },
    get writesInFlight() {
      return writesInFlight;
    },
    get writeEnds() {
      return writeEnds;
    },
    get createdCount() {
      return createdCount;
    },
  };
}

/** The column + card a cluster is born with, read back off the board. */
function seededOf(board: GraphState, cluster: OntologyCluster) {
  const column = board.objects[board.clusters.find((c) => c.id === cluster.id)!.columnIds[0]!]!;
  return { column, card: board.objects[column.childIds[0]!]! };
}

describe("createClusterOptimistic — ordering", () => {
  it("has the tab, its column and its first card on the board before the first POST leaves", () => {
    const h = harness();
    const { row } = createClusterOptimistic(h.api, h.sink);

    expect(h.sent).toHaveLength(1);
    const atSubmit = h.sent[0]!.board;
    expect(atSubmit.clusters.map((c) => c.id)).toEqual([row.id]);
    const { column, card } = seededOf(atSubmit, row);
    expect(column.name).toBe(NEW_COLUMN_NAME);
    expect(card.name).toBe(NEW_CARD_NAME);
    expect(row.name).toBe(NEW_CLUSTER_NAME);
  });

  it("marks all three rows pending, and holds the write gate open, from the click", () => {
    const h = harness();
    const { row } = createClusterOptimistic(h.api, h.sink);
    const { column, card } = seededOf(h.board, row);

    expect([...h.pending].sort()).toEqual([row.id, column.id, card.id].sort());
    expect([...h.pending].every(isPendingOntologyId)).toBe(true);
    expect(h.writesInFlight).toBe(1);
    // The gate opens BEFORE the request, or a realtime snapshot arriving in
    // the same tick could re-seed the reducer over rows that have no server
    // row yet — they would simply vanish.
    expect(h.order).toEqual([
      "markPending",
      "CLUSTER_ADD",
      "OBJECT_ADD",
      "OBJECT_ADD",
      "beginWrite",
    ]);
  });

  it("runs the seed POSTs against the ids the server minted, in order", async () => {
    const h = harness();
    createClusterOptimistic(h.api, h.sink);

    h.clusterCalls[0]!.settle(savedCluster());
    await flush();
    expect(h.sent[1]).toMatchObject({
      op: "createObject",
      input: { clusterId: "cluster-real", name: NEW_COLUMN_NAME },
    });

    h.objectCalls[0]!.settle(savedObject("column-real"));
    await flush();
    expect(h.sent[2]).toMatchObject({
      op: "createObject",
      input: { parentObjectId: "column-real", name: NEW_CARD_NAME },
    });
  });
});

describe("createClusterOptimistic — resolve", () => {
  it("swaps every provisional id for the real one and folds in the server slug", async () => {
    const h = harness();
    const { row, done } = createClusterOptimistic(h.api, h.sink);
    const { column, card } = seededOf(h.board, row);

    h.clusterCalls[0]!.settle(savedCluster());
    await flush();
    h.objectCalls[0]!.settle(savedObject("column-real"));
    await flush();
    h.objectCalls[1]!.settle(savedObject("card-real"));
    await done;

    const cluster = h.board.clusters[0]!;
    expect(cluster.id).toBe("cluster-real");
    // Slug is server-minted; optimistic cluster has none.
    expect(cluster.slug).toBe("new-cluster");
    expect(cluster.columnIds).toEqual(["column-real"]);
    expect(h.board.objects["column-real"]!.childIds).toEqual(["card-real"]);
    for (const gone of [row.id, column.id, card.id]) {
      expect(h.board.objects[gone]).toBeUndefined();
    }
    expect(Object.keys(h.board.objects).some(isPendingOntologyId)).toBe(false);
  });

  it("clears pending only AFTER the swap, and releases the gate once", async () => {
    const h = harness();
    const { done } = createClusterOptimistic(h.api, h.sink);

    h.clusterCalls[0]!.settle(savedCluster());
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

describe("createClusterOptimistic — rollback", () => {
  it("takes the whole optimistic cluster back off the board when a seed POST fails", async () => {
    const h = harness();
    const { done } = createClusterOptimistic(h.api, h.sink);

    h.clusterCalls[0]!.settle(savedCluster());
    await flush();
    const boom = new Error("seed column refused");
    h.objectCalls[0]!.fail(boom);
    expect(await done).toBeNull();

    // Column + card go with the cluster, else a ghost tab survives (F-031).
    expect(h.board).toEqual(EMPTY_GRAPH);
    expect(h.deletedClusters).toEqual(["cluster-real"]);
    expect(h.failures).toEqual([{ what: "create cluster", err: boom }]);
    expect(h.pending.size).toBe(0);
    expect(h.writesInFlight).toBe(0);
    expect(h.writeEnds).toBe(1);
    expect(h.createdCount).toBe(0);
  });

  it("deletes nothing server-side when the cluster POST itself fails", async () => {
    const h = harness();
    const { done } = createClusterOptimistic(h.api, h.sink);

    h.clusterCalls[0]!.fail(new Error("nope"));
    expect(await done).toBeNull();

    expect(h.board).toEqual(EMPTY_GRAPH);
    expect(h.deletedClusters).toEqual([]);
    expect(h.sent).toHaveLength(1);
  });

  it("leaves a board that already had clusters exactly as it found it", async () => {
    const h = harness();
    const existing: GraphState = {
      clusters: [savedCluster({ id: "c1", slug: "c1", columnIds: ["col1"] })],
      objects: { col1: savedObject("col1", { name: "Accounts" }) },
    };
    h.seed(existing);
    const { done } = createClusterOptimistic(h.api, h.sink);

    h.clusterCalls[0]!.fail(new Error("nope"));
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
    clusters: [savedCluster({ id: "c1", slug: "c1", columnIds: ["col1"] })],
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
    // Columns are templates server-side → pending card renders COMPLETE.
    expect(row.attributes).toEqual([
      { key: "owner", label: "Owner", value: { kind: "text", value: "" } },
      { key: "docs", label: "Docs", value: { kind: "knowledge", value: [] } },
    ]);
    expect(row.methods).toEqual(column.methods);
    expect(row.relationships).toEqual(column.relationships);
    expect(h.pending.has(row.id)).toBe(true);
  });

  it("adds a column straight to the cluster, with no inherited template", () => {
    const h = harness();
    h.seed(board);
    const { row } = createObjectOptimistic(h.api, h.sink, { clusterId: "c1" });

    expect(h.sent[0]!.board.clusters[0]!.columnIds).toEqual(["col1", row.id]);
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
