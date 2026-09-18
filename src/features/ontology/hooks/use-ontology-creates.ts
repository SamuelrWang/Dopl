"use client";

import { useCallback, useMemo, useState, type Dispatch } from "react";
import * as api from "../client/api";
import type { GraphAction } from "../graph-state";
import {
  beginColumnDraft,
  commitColumnDraftOptimistic,
  createClusterOptimistic,
  createObjectOptimistic,
  discardColumnDraft,
  type ColumnDraftPatch,
  type OntologyCreateApi,
  type OntologyCreateSink,
} from "../optimistic-create";
import type { OntologyCluster, OntologyObject } from "../types";

/**
 * Create half of the ontology store: owns the pending-id set and the sink
 * `optimistic-create.ts`'s sequences write through. Those sequences are not hooks
 * — the ordering they encode (dispatch, then POST) is the thing under test, and
 * is only testable outside React.
 */

/** The caller's create-side callbacks, held by ref by the store. */
export interface OntologyCreateCallbacks {
  /** A create was denied by the free object cap (`over_free_cap`). */
  onOverCap?: () => void;
  /** A row now exists server-side; the object cap is a server-side count, so the
   *  caller re-reads entitlements here (mirror of `onDeleted`). */
  onCreated?: () => void;
  /**
   * Provisional ids swapped for real ones. Anything holding an ontology id in its
   * own state (the views' selected cluster/object) must map through this, else a
   * selection on an optimistic row dangles when the server answers.
   */
  onIdsResolved?: (map: Readonly<Record<string, string>>) => void;
}

export interface OntologyCreatesParams {
  workspaceId: string;
  /** The RAW reducer dispatch (the store's API-mirroring one would re-send). */
  dispatch: Dispatch<GraphAction>;
  /** Marks local state as owning the truth, so no refetch re-seeds over it. */
  markDirty: () => void;
  /** Write-gate counters — a create holds realtime re-seeds off while it runs. */
  beginWrite: () => void;
  endWrite: () => void;
  /** Reads the LIVE graph: a card inherits the column as it is at submit. */
  getObject: (id: string) => OntologyObject | undefined;
  /** Live handle on callbacks that may be inline literals. */
  callbacks: { readonly current: OntologyCreateCallbacks };
  /** The store's one save-error toast. */
  reportError: (what: string, err: unknown) => void;
}

export interface OntologyCreates {
  /** Returns the row already on screen; the POSTs settle behind it. */
  createCluster: () => OntologyCluster;
  createObject: (
    target: { clusterId: string } | { parentObjectId: string }
  ) => OntologyObject;
  /**
   * "+ Object" — the lane on the board, POSTed by nothing until the popup's
   * Create (2026-09-11). Returns the row that is already on screen.
   */
  beginColumnDraft: (clusterId: string) => OntologyObject;
  /** Discard / Escape / backdrop — the lane leaves, no request either way. */
  discardColumnDraft: (draftId: string) => void;
  /** Create — POST the lane, then PATCH what the POST could not carry. */
  commitColumnDraft: (
    clusterId: string,
    draft: OntologyObject,
    patch: ColumnDraftPatch
  ) => void;
  /** Ids rendered but not yet acknowledged — these rows draw as pending. */
  pendingIds: ReadonlySet<string>;
}

export function useOntologyCreates({
  workspaceId,
  dispatch,
  markDirty,
  beginWrite,
  endWrite,
  getObject,
  callbacks,
  reportError,
}: OntologyCreatesParams): OntologyCreates {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  const markPending = useCallback((ids: readonly string[]) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clearPending = useCallback((ids: readonly string[]) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) changed = next.delete(id) || changed;
      return changed ? next : prev;
    });
  }, []);

  const boundApi = useMemo<OntologyCreateApi>(
    () => ({
      createCluster: (input) => api.createCluster(workspaceId, input),
      createObject: (input) => api.createObject(workspaceId, input),
      updateObject: (objectId, input) =>
        api.updateObject(workspaceId, objectId, input),
      deleteCluster: (clusterId) => api.deleteCluster(workspaceId, clusterId),
    }),
    [workspaceId]
  );

  const sink = useMemo<OntologyCreateSink>(
    () => ({
      dispatch,
      markPending,
      clearPending,
      resolve: (map, slugs) => {
        // Reducer first, then views: both land in one React batch, so a
        // selection never renders a frame pointed at an id that just moved.
        dispatch(slugs ? { type: "CREATE_RESOLVE", map, slugs } : { type: "CREATE_RESOLVE", map });
        callbacks.current.onIdsResolved?.(map);
      },
      beginWrite,
      endWrite,
      created: () => callbacks.current.onCreated?.(),
      failed: (what, err) => {
        if (api.isOverFreeCapError(err)) callbacks.current.onOverCap?.();
        else reportError(what, err);
      },
    }),
    [dispatch, markPending, clearPending, beginWrite, endWrite, callbacks, reportError]
  );

  const createCluster = useCallback((): OntologyCluster => {
    markDirty();
    // Fire-and-forget: every outcome is handled through the sink. The store's
    // write gate — not this promise — holds the realtime re-seed off until the
    // POSTs settle.
    const { row } = createClusterOptimistic(boundApi, sink);
    return row;
  }, [boundApi, sink, markDirty]);

  const createObject = useCallback(
    (target: { clusterId: string } | { parentObjectId: string }): OntologyObject => {
      markDirty();
      const parent =
        "parentObjectId" in target ? getObject(target.parentObjectId) : undefined;
      const { row } = createObjectOptimistic(boundApi, sink, target, parent);
      return row;
    },
    [boundApi, sink, markDirty, getObject]
  );

  /**
   * "+ Object" (2026-09-11): the lane first, the popup over it, the POST only on
   * Create. An object IS the lane — the object type — so the button makes exactly
   * one thing. Sequences are in `optimistic-create.ts`.
   */
  const begin = useCallback(
    (clusterId: string): OntologyObject => {
      markDirty();
      return beginColumnDraft(sink, clusterId);
    },
    [sink, markDirty]
  );

  const discard = useCallback(
    (draftId: string): void => discardColumnDraft(sink, draftId),
    [sink]
  );

  const commit = useCallback(
    (clusterId: string, draft: OntologyObject, patch: ColumnDraftPatch): void => {
      markDirty();
      // Fire-and-forget: the sink handles every outcome.
      commitColumnDraftOptimistic(boundApi, sink, clusterId, draft, patch);
    },
    [boundApi, sink, markDirty]
  );

  return {
    createCluster,
    createObject,
    beginColumnDraft: begin,
    discardColumnDraft: discard,
    commitColumnDraft: commit,
    pendingIds,
  };
}
