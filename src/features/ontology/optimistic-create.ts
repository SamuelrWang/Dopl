"use client";

import { planOntologyCreateRollback } from "./create-ontology-rollback";
import type { GraphAction } from "./graph-state";
import type { OntologyObjectUpdateInput } from "./schema";
import type {
  AttributeValue,
  Ontology,
  OntologyObject,
  TemplateField,
} from "./types";

/**
 * Optimistic creates for the ontology board — the write path's ordering half,
 * outside React so it's testable as a sequence.
 *
 * Before the first POST leaves: provisional ids minted, rows dispatched into
 * the reducer as PENDING (`src/shared/ui/pending.ts`). POSTs then run SERIALLY
 * — each needs the id the previous minted. `CREATE_RESOLVE` swaps ids in place;
 * a failure removes the rows and cleans the server half (F-031).
 *
 * Not `useApiMutation`: that patches the TanStack cache, but this board renders
 * from `graphReducer` (`use-ontology.ts` `dirtyRef`), so a cache patch lands
 * where no observer reads.
 */

/** Marks an id the server has not acknowledged yet — never sent as a target. */
const PENDING_ID_PREFIX = "pending:";

/** True for a row that exists only on screen. Prefixed, not a bare uuid, so a
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

/** Shared by the optimistic row and the POST body so they cannot drift. */
export const NEW_ONTOLOGY_NAME = "New ontology";
/** The lane's born name: "object", not "column", since 2026-09-11. The
 *  identifier keeps the code's word; only what a person reads changed. */
export const NEW_COLUMN_NAME = "Untitled object";
export const NEW_CARD_NAME = "New object";

function emptyValue(kind: AttributeValue["kind"]): AttributeValue {
  return kind === "text" || kind === "pill" ? { kind, value: "" } : { kind, value: [] };
}

/**
 * The row the server would build, built locally. Must mirror
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
 *  optimistic ontology has none until `CREATE_RESOLVE` folds it in. */
function pendingOntology(): Ontology {
  return {
    id: newPendingId(),
    slug: "",
    name: NEW_ONTOLOGY_NAME,
    purpose: "",
    columnIds: [],
    layout: {},
  };
}

/** The writes a create can make, with the workspace already bound. */
export interface OntologyCreateApi {
  createOntology(input: { name: string }): Promise<Ontology>;
  createObject(input: {
    ontologyId?: string;
    parentObjectId?: string;
    name: string;
  }): Promise<OntologyObject>;
  /**
   * The second half of a popup-filled create: the create POST carries a name and
   * nothing else (`schema.ts › OntologyObjectCreateSchema`), so the popup's
   * description and field list land as one PATCH at the id the POST just minted
   * — never at the provisional one.
   */
  updateObject(
    objectId: string,
    input: OntologyObjectUpdateInput
  ): Promise<OntologyObject>;
  deleteOntology(ontologyId: string): Promise<void>;
}

/** Everything a create does to the outside world. Injected so a hand-settled
 *  transport can prove dispatches happen BEFORE the first request leaves. */
export interface OntologyCreateSink {
  /** Straight into the reducer — never the API-mirroring `dispatch`. */
  dispatch(action: GraphAction): void;
  /** On screen, not yet acknowledged: these rows render inert. */
  markPending(ids: readonly string[]): void;
  clearPending(ids: readonly string[]): void;
  /** Provisional ids → the ids the server minted, plus new ontology slugs. */
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

/** The optimistic row, returned synchronously, plus the settle of its POSTs. */
export interface OptimisticCreate<T> {
  /** Already in the reducer — safe to select, address and render. */
  row: T;
  /** Resolves with the server's row, or null once the failure is handled. */
  done: Promise<T | null>;
}

/** "New ontology": tab, seed column, seed card on screen in the click's frame,
 *  then three serial POSTs behind them. */
export function createOntologyOptimistic(
  api: OntologyCreateApi,
  sink: OntologyCreateSink
): OptimisticCreate<Ontology> {
  const ontology = pendingOntology();
  const column = pendingObject(NEW_COLUMN_NAME);
  const card = pendingObject(NEW_CARD_NAME, column);
  const ids = [ontology.id, column.id, card.id];

  // Pixels first: nothing below this line is awaited before the board changes.
  sink.markPending(ids);
  sink.dispatch({ type: "ONTOLOGY_ADD", ontology });
  sink.dispatch({ type: "OBJECT_ADD", object: column, ontologyId: ontology.id });
  sink.dispatch({ type: "OBJECT_ADD", object: card, parentObjectId: column.id });
  sink.beginWrite();

  const done = (async (): Promise<Ontology | null> => {
    // Guard for the SERVER half of the rollback: a later POST failing leaves an
    // orphan ontology row (F-031).
    let createdOntologyId: string | null = null;
    try {
      const savedOntology = await api.createOntology({ name: ontology.name });
      createdOntologyId = savedOntology.id;
      const savedColumn = await api.createObject({
        ontologyId: savedOntology.id,
        name: column.name,
      });
      const savedCard = await api.createObject({
        parentObjectId: savedColumn.id,
        name: card.name,
      });
      sink.resolve(
        {
          [ontology.id]: savedOntology.id,
          [column.id]: savedColumn.id,
          [card.id]: savedCard.id,
        },
        { [savedOntology.id]: savedOntology.slug }
      );
      sink.created();
      return savedOntology;
    } catch (err) {
      // Local half first, whole: ONTOLOGY_DELETE cascades to the owned column +
      // card, so no ghost tab survives. Server half after, best-effort.
      sink.dispatch({ type: "ONTOLOGY_DELETE", id: ontology.id });
      const plan = planOntologyCreateRollback(createdOntologyId);
      if (plan.rollback) {
        void api.deleteOntology(plan.ontologyId).catch(() => undefined);
      }
      sink.failed("create ontology", err);
      return null;
    } finally {
      // After `resolve`, never before: an id is real only once swapped.
      sink.clearPending(ids);
      sink.endWrite();
    }
  })();

  return { row: ontology, done };
}

/** What the "New object" popup collects, applied to the draft lane on Create. */
export interface ColumnDraftPatch {
  name: string;
  subtitle: string;
  template: TemplateField[];
}

/**
 * "+ Object" (2026-09-11): the lane appears and nothing is sent. The one create
 * path that does not POST from the click — a create that had already left could
 * only be taken back with a DELETE at an id that is still `pending:…` while the
 * operator types, whereas a reducer-only row is withdrawn by
 * {@link discardColumnDraft} with no request at all.
 *
 * Marked pending like every other provisional row, so the lane draws inert and
 * nothing may be written at it until {@link commitColumnDraftOptimistic} resolves
 * a real id.
 */
export function beginColumnDraft(
  sink: OntologyCreateSink,
  ontologyId: string
): OntologyObject {
  const object = pendingObject(NEW_COLUMN_NAME);
  sink.markPending([object.id]);
  sink.dispatch({ type: "OBJECT_ADD", object, ontologyId });
  return object;
}

/** Discard / Escape / backdrop: the lane leaves the board. No request in either
 *  direction — nothing was ever sent for it. */
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
 * Two requests, and only the first can undo the lane. A refused POST removes it
 * — nothing exists. A refused PATCH does not: the row is on the server, and
 * deleting the lane because its description did not save would destroy more than
 * it repairs, so it reports instead.
 *
 * The typed values land in the reducer first, so the lane wears its real name in
 * the click's frame rather than after the round trip.
 */
export function commitColumnDraftOptimistic(
  api: OntologyCreateApi,
  sink: OntologyCreateSink,
  ontologyId: string,
  draft: OntologyObject,
  patch: ColumnDraftPatch
): OptimisticCreate<OntologyObject> {
  sink.dispatch({ type: "OBJECT_UPDATE", id: draft.id, patch });
  sink.beginWrite();

  const done = (async (): Promise<OntologyObject | null> => {
    let saved: OntologyObject | null = null;
    try {
      saved = await api.createObject({ ontologyId, name: patch.name });
      sink.resolve({ [draft.id]: saved.id });
      sink.created();
      // Only when there is something the POST could not carry.
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
  target: { ontologyId: string } | { parentObjectId: string },
  parent?: OntologyObject
): OptimisticCreate<OntologyObject> {
  const isColumn = "ontologyId" in target;
  const object = pendingObject(
    isColumn ? NEW_COLUMN_NAME : NEW_CARD_NAME,
    isColumn ? undefined : parent
  );

  sink.markPending([object.id]);
  sink.dispatch({ type: "OBJECT_ADD", object, ...target });
  sink.beginWrite();

  const done = (async (): Promise<OntologyObject | null> => {
    try {
      // Target captured at submit — never re-read from current selection, which
      // may have moved during the round trip.
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
