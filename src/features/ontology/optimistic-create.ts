"use client";

import { planClusterCreateRollback } from "./create-cluster-rollback";
import type { GraphAction } from "./graph-state";
import type {
  AttributeValue,
  OntologyCluster,
  OntologyObject,
} from "./types";

/**
 * OPTIMISTIC CREATES for the ontology board — the ordering half of the write
 * path, kept out of React so it can be tested as what it is: a sequence.
 *
 * What this replaced (roadmap §5, the worst latency-to-pixel ratio in the app):
 * "New cluster" fired THREE serial POSTs — cluster, seed column, seed card —
 * and dispatched nothing until each answered. The click changed no pixel at
 * all for the length of three round trips, then the whole board appeared at
 * once. `+Column` / `+Card` were the same shape with one hop instead of three.
 *
 * What happens now, before the first POST leaves: provisional ids are minted,
 * the cluster / column / card are dispatched into the reducer, and they render
 * as PENDING rows (dimmed + inert, `src/shared/ui/pending.ts`). The POSTs then
 * run in the same order they always did — they have to, each one needs the id
 * the previous one minted — but the user is not waiting on them. When they
 * answer, `CREATE_RESOLVE` swaps every provisional id for the real one in
 * place; when one fails, the optimistic rows are removed and the server half is
 * cleaned up (F-031).
 *
 * WHY NOT `useApiMutation`: the shared write layer patches the TANSTACK CACHE,
 * and the ontology board does not render from the cache — it renders from
 * `graphReducer`, seeded once from the snapshot query and authoritative from
 * then on (`use-ontology.ts`'s `dirtyRef`). A cache patch here would land in an
 * entry no observer reads. The reducer IS this feature's optimistic engine, so
 * the four rules are honoured against it rather than against the cache: cancel
 * is moot (nothing refetches into the reducer without passing the write gate),
 * the rollback is a reducer dispatch, invalidation stays explicit (none — the
 * reducer holds the truth), and every write is keyed by ids captured at submit.
 */

/** Marks an id the server has not acknowledged yet — never sent as a target. */
const PENDING_ID_PREFIX = "pending:";

/** True for a row that exists only on screen. Prefixed rather than a bare
 *  uuid so a provisional id that leaks into a request fails the server's uuid
 *  check instead of being stored as a dangling reference. */
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

/** The names the server has always been sent — kept here so the optimistic row
 *  and the POST body cannot drift apart. */
export const NEW_CLUSTER_NAME = "New cluster";
export const NEW_COLUMN_NAME = "Untitled column";
export const NEW_CARD_NAME = "New object";

function emptyValue(kind: AttributeValue["kind"]): AttributeValue {
  return kind === "text" || kind === "pill" ? { kind, value: "" } : { kind, value: [] };
}

/**
 * The row the server would build, built locally instead.
 *
 * `parent` is the column a card is being added to: columns act as templates, so
 * the server births a card with the column's template fields as empty
 * attributes and a copy of its actions and relationships (`server/service.ts`
 * → `createObject`). Mirroring that rule here is what lets the pending card
 * render COMPLETE — attribute count and all — rather than as a stub that
 * rearranges itself when the POST answers.
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

/**
 * Everything a create does to the outside world. Injected so the ordering can
 * be driven by a test with a hand-settled transport — the point being proven is
 * that the dispatches happen BEFORE the first request leaves, which a runner
 * that awaits the whole thing cannot see.
 */
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

/**
 * "New cluster": tab, seed column and seed card on screen in the same frame as
 * the click, then three serial POSTs behind them.
 */
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
    // Tracks whether the cluster POST landed — the guard for the SERVER half of
    // the rollback: a later POST that fails leaves an orphan cluster row (F-031).
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
      // Local half first, and whole: CLUSTER_DELETE cascades to the column and
      // card this cluster owns, so a half-created cluster never survives as a
      // ghost tab. Then the server half, best-effort.
      sink.dispatch({ type: "CLUSTER_DELETE", id: cluster.id });
      const plan = planClusterCreateRollback(createdClusterId);
      if (plan.rollback) {
        void api.deleteCluster(plan.clusterId).catch(() => undefined);
      }
      sink.failed("create cluster", err);
      return null;
    } finally {
      // After `resolve`, never before: an id is only real once it is swapped.
      sink.clearPending(ids);
      sink.endWrite();
    }
  })();

  return { row: cluster, done };
}

/**
 * "+ Column" / "Add new": the card is in its lane before the POST leaves.
 * `parent` is the column a card is nested under, for template inheritance.
 */
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
      // The TARGET is the one captured at submit — never re-read from the
      // current selection, which may have moved during the round trip.
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
