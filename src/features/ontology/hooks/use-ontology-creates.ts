"use client";

import { useCallback, useMemo, useState, type Dispatch } from "react";
import * as api from "../client/api";
import type { GraphAction } from "../graph-state";
import {
  createClusterOptimistic,
  createObjectOptimistic,
  type OntologyCreateApi,
  type OntologyCreateSink,
} from "../optimistic-create";
import type { OntologyCluster, OntologyObject } from "../types";

/**
 * Create half of the ontology store: owns the pending-id set and the sink
 * `optimistic-create.ts`'s sequences write through. ⚠ Those sequences are NOT
 * hooks — the ordering they encode (dispatch, then POST) is the thing under
 * test, and is only testable outside React.
 */

/** The caller's create-side callbacks, held by ref by the store. */
export interface OntologyCreateCallbacks {
  /** A create was denied by the free object cap (`over_free_cap`). */
  onOverCap?: () => void;
  /** A row now exists SERVER-side; object cap is a server-side count, so the
   *  caller re-reads entitlements here (mirror of `onDeleted`). */
  onCreated?: () => void;
  /**
   * Provisional ids swapped for real ones. ⚠ Anything holding an ontology id in
   * ITS OWN state (the views' selected cluster/object) must map through this,
   * else a selection on an optimistic row dangles when the server answers.
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
  /** Returns the row ALREADY on screen; the POSTs settle behind it. */
  createCluster: () => OntologyCluster;
  createObject: (
    target: { clusterId: string } | { parentObjectId: string }
  ) => OntologyObject;
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
        // ⚠ Reducer first, then views: both land in one React batch, so a
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
    // Fire-and-forget: every outcome is handled through the sink (resolve /
    // rollback / toast). The store's write gate — not this promise — holds the
    // realtime re-seed off until the POSTs settle.
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

  return { createCluster, createObject, pendingIds };
}
