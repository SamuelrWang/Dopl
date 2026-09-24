/**
 * The create-sequence harness — fake transport + real reducer, driven by both
 * `optimistic-create.test.ts` and `optimistic-create-draft.test.ts`. One copy, so
 * both suites share one definition of "the board as the request left".
 */

import {
  EMPTY_GRAPH,
  graphReducer,
  type GraphAction,
  type GraphState,
} from "./graph-state";
import { NEW_ONTOLOGY_NAME, type OntologyCreateApi, type OntologyCreateSink } from "./optimistic-create";
import type { Ontology, OntologyObject } from "./types";

interface Deferred<T> {
  promise: Promise<T>;
  settle: (value: T) => void;
  fail: (err: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
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
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export const savedOntology = (over: Partial<Ontology> = {}): Ontology => ({
  id: "ontology-real",
  slug: "new-ontology",
  name: NEW_ONTOLOGY_NAME,
  purpose: "",
  columnIds: [],
  layout: {},
  ...over,
});

export const savedObject = (id: string, over: Partial<OntologyObject> = {}): OntologyObject => ({
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
export function harness() {
  let state: GraphState = EMPTY_GRAPH;
  const pending = new Set<string>();
  const order: string[] = [];
  const failures: Array<{ what: string; err: unknown }> = [];
  const sent: Array<{ op: string; input: unknown; board: GraphState }> = [];
  const deletedOntologies: string[] = [];
  const ontologyCalls: Array<Deferred<Ontology>> = [];
  const objectCalls: Array<Deferred<OntologyObject>> = [];
  const patchCalls: Array<Deferred<OntologyObject>> = [];
  let writesInFlight = 0;
  let writeEnds = 0;
  let createdCount = 0;

  const record = (op: string, input: unknown) => sent.push({ op, input, board: state });

  const api: OntologyCreateApi = {
    createOntology: (input) => {
      record("createOntology", input);
      const call = deferred<Ontology>();
      ontologyCalls.push(call);
      return call.promise;
    },
    createObject: (input) => {
      record("createObject", input);
      const call = deferred<OntologyObject>();
      objectCalls.push(call);
      return call.promise;
    },
    updateObject: (objectId, input) => {
      record("updateObject", { objectId, ...input });
      const call = deferred<OntologyObject>();
      patchCalls.push(call);
      return call.promise;
    },
    deleteOntology: (ontologyId) => {
      deletedOntologies.push(ontologyId);
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
    deletedOntologies,
    ontologyCalls,
    objectCalls,
    patchCalls,
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

/** The column + card an ontology is born with, read back off the board. */
export function seededOf(board: GraphState, ontology: Ontology) {
  const column = board.objects[board.ontologies.find((c) => c.id === ontology.id)!.columnIds[0]!]!;
  return { column, card: board.objects[column.childIds[0]!]! };
}

