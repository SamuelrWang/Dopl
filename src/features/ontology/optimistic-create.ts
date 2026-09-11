"use client";

import { planClusterCreateRollback } from "./create-cluster-rollback";
import type { GraphAction } from "./graph-state";
import type { OntologyObjectUpdateInput } from "./schema";
import type {
  AttributeValue,
  OntologyCluster,
  OntologyObject,
  TemplateField,
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
/**
 * THE LANE'S BORN NAME. ⚠ **"object", NOT "column", SINCE 2026-09-11** (Samuel:
 * *"We're going to rename this from Column to Object … Untitled Object, not
 * Column"*) — a lane IS an object type, and "column" was the board's word for it
 * leaking into the operator's. The identifier keeps the code's word; only what a
 * person reads changed.
 */
export const NEW_COLUMN_NAME = "Untitled object";
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

/** The writes a create can make, with the workspace already bound. */
export interface OntologyCreateApi {
  createCluster(input: { name: string }): Promise<OntologyCluster>;
  createObject(input: {
    clusterId?: string;
    parentObjectId?: string;
    name: string;
  }): Promise<OntologyObject>;
  /**
   * ⚠ THE SECOND HALF OF A POPUP-FILLED CREATE, and it exists because the
   * CREATE POST carries a NAME AND NOTHING ELSE (`schema.ts ›
   * OntologyObjectCreateSchema`). The New object popup also collects a
   * description and a field list, so those land as one PATCH at the id the POST
   * just minted — never at the provisional one.
   */
  updateObject(
    objectId: string,
    input: OntologyObjectUpdateInput
  ): Promise<OntologyObject>;
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

/** What the "New object" popup collects, applied to the draft lane on Create. */
export interface ColumnDraftPatch {
  name: string;
  subtitle: string;
  template: TemplateField[];
}

/**
 * "+ Object" — THE LANE APPEARS AND NOTHING IS SENT (2026-09-11, Samuel: *"I want
 * the column UI to immediately appear on the thing, but at the same time, a
 * pop-up comes up. If the user doesn't actually end up creating it, that little
 * thing disappears"*).
 *
 * ⚠ **THE ONE CREATE PATH THAT DOES NOT POST FROM THE CLICK**, and the popup is
 * the reason: a create that had already left could only be taken back with a
 * DELETE — at an id that is still `pending:…` while the operator types. A row
 * that exists ONLY in the reducer is withdrawn by {@link discardColumnDraft}
 * with no request at all, which is the behaviour Samuel described.
 *
 * ⚠ It is marked PENDING like every other provisional row, so the lane draws
 * inert (`shared/ui/pending.ts`) — its id is provisional and nothing may be
 * written at it until {@link commitColumnDraftOptimistic} resolves one.
 */
export function beginColumnDraft(
  sink: OntologyCreateSink,
  clusterId: string
): OntologyObject {
  const object = pendingObject(NEW_COLUMN_NAME);
  sink.markPending([object.id]);
  sink.dispatch({ type: "OBJECT_ADD", object, clusterId });
  return object;
}

/** Discard / Escape / backdrop: the lane leaves the board. ⚠ NO REQUEST, in
 *  either direction — nothing was ever sent for it (see above). */
export function discardColumnDraft(
  sink: OntologyCreateSink,
  draftId: string
): void {
  sink.dispatch({ type: "OBJECT_DELETE", id: draftId });
  sink.clearPending([draftId]);
}

/**
 * Create: the lane the operator has been looking at becomes a real row.
 *
 * ⚠ **TWO REQUESTS, AND ONLY THE FIRST CAN UNDO THE LANE.** The POST carries the
 * name (all the create schema takes); the description and the field list follow
 * as a PATCH at the id it minted. A refused POST removes the lane — nothing
 * exists. A refused PATCH does NOT: the row is on the server, and deleting the
 * operator's lane because its description did not save would destroy more than
 * it repairs. It reports instead.
 *
 * ⚠ The typed values land in the reducer FIRST, so the lane wears its real name
 * in the click's frame rather than after the round trip.
 */
export function commitColumnDraftOptimistic(
  api: OntologyCreateApi,
  sink: OntologyCreateSink,
  clusterId: string,
  draft: OntologyObject,
  patch: ColumnDraftPatch
): OptimisticCreate<OntologyObject> {
  sink.dispatch({ type: "OBJECT_UPDATE", id: draft.id, patch });
  sink.beginWrite();

  const done = (async (): Promise<OntologyObject | null> => {
    let saved: OntologyObject | null = null;
    try {
      saved = await api.createObject({ clusterId, name: patch.name });
      sink.resolve({ [draft.id]: saved.id });
      sink.created();
      // ⚠ Only when there is something the POST could not carry.
      if (patch.subtitle !== "" || patch.template.length > 0) {
        await api.updateObject(saved.id, {
          subtitle: patch.subtitle,
          template: patch.template,
        });
      }
      return saved;
    } catch (err) {
      if (saved === null) {
        sink.dispatch({ type: "OBJECT_DELETE", id: draft.id });
        sink.failed("create object", err);
        return null;
      }
      sink.failed("object", err);
      return saved;
    } finally {
      sink.clearPending([draft.id]);
      sink.endWrite();
    }
  })();

  return { row: draft, done };
}

/** "Add new": row is in its lane before the POST leaves. `parent` = the column
 *  a card nests under, for template inheritance. */
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
