"use client";

import { planClusterCreateRollback } from "./create-cluster-rollback";
import type { GraphAction } from "./graph-state";
import type {
  AttributeValue,
  OntologyCluster,
  OntologyObject,
} from "./types";

/**
 * OPTIMISTIC CREATES for the ontology board — the write path's ordering half,
 * outside React so it's testable as a sequence.
 *
 * Before the first POST leaves: provisional ids minted, rows dispatched into
 * the reducer as PENDING (`src/shared/ui/pending.ts`). POSTs then run SERIALLY
 * — each needs the id the previous minted. `CREATE_RESOLVE` swaps ids in place;
 * a failure removes the rows and cleans the server half (F-031).
 *
 * ⚠ NOT `useApiMutation`: that patches the TANSTACK CACHE, but this board
 * renders from `graphReducer` (`use-ontology.ts` `dirtyRef`), so a cache patch
 * lands where no observer reads. The reducer IS the optimistic engine —
 * rollback is a dispatch, invalidation is none, writes keyed by submit-time ids.
 */

/** Marks an id the server has not acknowledged yet — never sent as a target. */
const PENDING_ID_PREFIX = "pending:";

/** True for a row that exists only on screen. ⚠ Prefixed, not a bare uuid, so a
 *  leaked provisional id fails the server's uuid check instead of being stored
 *  as a dangling reference. */
export function isPendingOntologyId(id: string): boolean {
  return id.startsWith(PENDING_ID_PREFIX);
}

function newPendingId(): string {
  const cryptoRef = globalThis.crypto;
  const token = cryptoRef?.randomUUID
    ? cryptoRef.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${PENDING_ID_PREFIX}${token}`;
}

/** ⚠ Shared by the optimistic row AND the POST body so they cannot drift. */
export const NEW_CLUSTER_NAME = "New cluster";
export const NEW_COLUMN_NAME = "Untitled column";
export const NEW_CARD_NAME = "New object";

function emptyValue(kind: AttributeValue["kind"]): AttributeValue {
  return kind === "text" || kind === "pill" ? { kind, value: "" } : { kind, value: [] };
}

/**
 * The row the server would build, built locally. ⚠ Must mirror
 * `server/service.ts › createObject` (columns are templates: card born with
 * template fields as empty attributes + copies of actions/relationships).
 * Drift → pending card renders as a stub that rearranges when the POST answers.
 */
function pendingObject(name: string, parent?: OntologyObject): OntologyObject {
  return {
    id: newPendingId(),
    name,
    subtitle: "",
    attributes: (parent?.template ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      value: emptyValue(f.kind),
    })),
    relationships: (parent?.relationships ?? []).map((r) => ({
      ...r,
      targetIds: [...r.targetIds],
    })),
    methods: (parent?.methods ?? []).map((m) => ({ ...m })),
    childIds: [],
    template: [],
  };
}

/** Slug is server-minted (uniqueness is a table-wide question), so the
 *  optimistic cluster has none until `CREATE_RESOLVE` folds it in. */
function pendingCluster(): OntologyCluster {
  return {
    id: newPendingId(),
    slug: "",
    name: NEW_CLUSTER_NAME,
    purpose: "",
    columnIds: [],
    layout: {},
  };
}

/** The three POSTs a create can make, with the workspace already bound. */
export interface OntologyCreateApi {
  createCluster(input: { name: string }): Promise<OntologyCluster>;
  createObject(input: {
    clusterId?: string;
    parentObjectId?: string;
    name: string;
  }): Promise<OntologyObject>;
  deleteCluster(clusterId: string): Promise<void>;
}

/** Everything a create does to the outside world. Injected so a hand-settled
 *  transport can prove dispatches happen BEFORE the first request leaves. */
export interface OntologyCreateSink {
  /** Straight into the reducer — never the API-mirroring `dispatch`. */
  dispatch(action: GraphAction): void;
  /** On screen, not yet acknowledged: these rows render inert. */
  markPending(ids: readonly string[]): void;
  clearPending(ids: readonly string[]): void;
  /** Provisional ids → the ids the server minted, plus new cluster slugs. */
  resolve(
    map: Readonly<Record<string, string>>,
    slugs?: Readonly<Record<string, string>>
  ): void;
  /** Holds realtime snapshot re-seeds off for the life of the write. */
  beginWrite(): void;
  endWrite(): void;
  /** A row now exists server-side (the object cap is a server-side count). */
  created(): void;
  /** Over-cap prompt or save-error toast — the caller decides which. */
  failed(what: string, err: unknown): void;
}

/** The optimistic row, returned SYNCHRONOUSLY, plus the settle of its POSTs. */
export interface OptimisticCreate<T> {
  /** Already in the reducer — safe to select, address and render. */
  row: T;
  /** Resolves with the server's row, or null once the failure is handled. */
  done: Promise<T | null>;
}

/** "New cluster": tab, seed column, seed card on screen in the click's frame,
 *  then three serial POSTs behind them. */
export function createClusterOptimistic(
  api: OntologyCreateApi,
  sink: OntologyCreateSink
): OptimisticCreate<OntologyCluster> {
  const cluster = pendingCluster();
  const column = pendingObject(NEW_COLUMN_NAME);
  const card = pendingObject(NEW_CARD_NAME, column);
  const ids = [cluster.id, column.id, card.id];

  // PIXELS FIRST. Nothing below this line is awaited before the board changes.
  sink.markPending(ids);
  sink.dispatch({ type: "CLUSTER_ADD", cluster });
  sink.dispatch({ type: "OBJECT_ADD", object: column, clusterId: cluster.id });
  sink.dispatch({ type: "OBJECT_ADD", object: card, parentObjectId: column.id });
  sink.beginWrite();

  const done = (async (): Promise<OntologyCluster | null> => {
    // Guard for the SERVER half of the rollback: a later POST failing leaves an
    // orphan cluster row (F-031).
    let createdClusterId: string | null = null;
    try {
      const savedCluster = await api.createCluster({ name: cluster.name });
      createdClusterId = savedCluster.id;
      const savedColumn = await api.createObject({
        clusterId: savedCluster.id,
        name: column.name,
      });
      const savedCard = await api.createObject({
        parentObjectId: savedColumn.id,
        name: card.name,
      });
      sink.resolve(
        {
          [cluster.id]: savedCluster.id,
          [column.id]: savedColumn.id,
          [card.id]: savedCard.id,
        },
        { [savedCluster.id]: savedCluster.slug }
      );
      sink.created();
      return savedCluster;
    } catch (err) {
      // Local half first, whole: CLUSTER_DELETE cascades to the owned column +
      // card, so no ghost tab survives. Server half after, best-effort.
      sink.dispatch({ type: "CLUSTER_DELETE", id: cluster.id });
      const plan = planClusterCreateRollback(createdClusterId);
      if (plan.rollback) {
        void api.deleteCluster(plan.clusterId).catch(() => undefined);
      }
      sink.failed("create cluster", err);
      return null;
    } finally {
      // ⚠ After `resolve`, never before: an id is real only once swapped.
      sink.clearPending(ids);
      sink.endWrite();
    }
  })();

  return { row: cluster, done };
}

/** "+ Column" / "Add new": row is in its lane before the POST leaves. `parent`
 *  = the column a card nests under, for template inheritance. */
export function createObjectOptimistic(
  api: OntologyCreateApi,
  sink: OntologyCreateSink,
  target: { clusterId: string } | { parentObjectId: string },
  parent?: OntologyObject
): OptimisticCreate<OntologyObject> {
  const isColumn = "clusterId" in target;
  const object = pendingObject(
    isColumn ? NEW_COLUMN_NAME : NEW_CARD_NAME,
    isColumn ? undefined : parent
  );

  sink.markPending([object.id]);
  sink.dispatch({ type: "OBJECT_ADD", object, ...target });
  sink.beginWrite();

  const done = (async (): Promise<OntologyObject | null> => {
    try {
      // ⚠ TARGET captured at submit — never re-read from current selection,
      // which may have moved during the round trip.
      const saved = await api.createObject({ ...target, name: object.name });
      sink.resolve({ [object.id]: saved.id });
      sink.created();
      return saved;
    } catch (err) {
      sink.dispatch({ type: "OBJECT_DELETE", id: object.id });
      sink.failed("create object", err);
      return null;
    } finally {
      sink.clearPending([object.id]);
      sink.endWrite();
    }
  })();

  return { row: object, done };
}
