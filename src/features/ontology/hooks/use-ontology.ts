"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createRefetchCoordinator,
  type RefetchCoordinator,
} from "@/shared/realtime/refetch-coordinator";
import { toast } from "@/shared/ui/toast";
import * as api from "../client/api";
import { planDeleteRollback } from "../delete-rollback";
import { useOntologyRealtime } from "../client/realtime";
import {
  clusterObjectIds,
  EMPTY_GRAPH,
  graphReducer,
  objectIdToSync,
  type GraphAction,
  type GraphState,
} from "../graph-state";
import {
  useOntologyCreates,
  type OntologyCreateCallbacks,
} from "./use-ontology-creates";
import type { OntologyCluster, OntologyObject } from "../types";

const OBJECT_SYNC_DELAY_MS = 800;

/** TanStack key for the workspace ontology snapshot. */
export const ontologySnapshotKey = (workspaceId: string) =>
  ["ontology-snapshot", workspaceId] as const;

export type OntologyStatus = "loading" | "ready" | "error";

export interface UseOntologyOptions extends OntologyCreateCallbacks {
  /** An object or cluster was permanently deleted ON THE SERVER. Object cap is
   *  a server-side count and deleting is the only way back under it — caller
   *  must refresh entitlements here or the cap meter (and the `overCap` create
   *  short-circuit) stays stuck at the pre-delete number until a reload. */
  onDeleted?: () => void;
}

/**
 * Ontology store with persistence. Object edits debounced per object
 * (full-state PATCH, idempotent), deletes immediate, creates optimistic
 * (`optimistic-create.ts`). A refused delete/create rolls back into the reducer
 * (`delete-rollback.ts`).
 */
export function useOntology(
  workspaceId: string,
  options: UseOntologyOptions = {}
): {
  graph: GraphState;
  status: OntologyStatus;
  dispatch: (action: GraphAction) => void;
  /** Both return the row that is ALREADY on screen — no await to a pixel. */
  createCluster: () => OntologyCluster;
  createObject: (
    target: { clusterId: string } | { parentObjectId: string }
  ) => OntologyObject;
  /** Ids whose row is on screen but unacknowledged: render them pending. */
  pendingIds: ReadonlySet<string>;
} {
  const [graph, rawDispatch] = useReducer(graphReducer, EMPTY_GRAPH);
  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  // Ref keeps create/delete callbacks stable when the caller passes an inline
  // handler or a fresh options literal.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Fired PATCHes awaiting their round trip. With `timersRef.size` this is the
  // "writes in flight" signal realtime refetch defers on (`hasPendingWrites`).
  const inFlightRef = useRef(0);

  // Snapshot through the query cache: revisit paints instantly, background
  // refetch brings it current. ⚠ Focus refetch stays OFF — a surprise
  // SNAPSHOT_SET mid-edit clobbers the reducer's optimistic edits.
  const snapshotQuery = useQuery({
    queryKey: ontologySnapshotKey(workspaceId),
    queryFn: () => api.fetchSnapshot(workspaceId),
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    staleTime: 0,
  });

  // Seed/refresh reducer from query data, ⚠ never over local edits: once the
  // user has dispatched anything later refetches are ignored (debounced writes
  // own persistence; next mount refetches).
  const dirtyRef = useRef(false);
  const seededRef = useRef(false);
  // `seeded` mirrors seededRef as state: status must track when the REDUCER has
  // the snapshot, not the query cache — else the empty-graph frame flashes the
  // "create your first cluster" CTA on a cached revisit.
  const [seeded, setSeeded] = useState(false);
  const snapshot = snapshotQuery.data;
  useEffect(() => {
    dirtyRef.current = false;
    seededRef.current = false;
    // One-shot reset on workspace switch, no render-loop risk (same sanctioned
    // pattern as connect-agent-banner's mount read).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeeded(false);
  }, [workspaceId]);
  useEffect(() => {
    if (!snapshot) return;
    if (seededRef.current && dirtyRef.current) return;
    rawDispatch({ type: "SNAPSHOT_SET", snapshot });
    seededRef.current = true;
    // Flips exactly once per (workspace, first-snapshot) pair.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeeded(true);
  }, [snapshot]);

  // Seeded wins over error: a failed background refetch must not blank a
  // working (possibly mid-edit) board. "error" only before first load.
  const status: OntologyStatus = seeded
    ? "ready"
    : snapshotQuery.error
      ? "error"
      : "loading";

  // ── Live updates from MCP/CLI agents and other tabs ────────────────
  // Remote change refetches + re-seeds, bypassing the seed effect's dirty-guard.
  // ⚠ Never apply a remote snapshot while a local write is in flight: the
  // coordinator defers until debounced PATCHes have fired AND returned, then
  // applies the coalesced refetch. Own edits echo back — harmless re-seed.
  const refetchSnapshot = snapshotQuery.refetch;
  const hasPendingWrites = useCallback(
    () => timersRef.current.size > 0 || inFlightRef.current > 0,
    []
  );
  const coordinatorRef = useRef<RefetchCoordinator | null>(null);
  const applyRemoteSnapshot = useCallback(async () => {
    const { data } = await refetchSnapshot();
    if (!data) return;
    // A write may have started during the fetch — re-defer, don't overwrite.
    if (hasPendingWrites()) {
      coordinatorRef.current?.request(true);
      return;
    }
    rawDispatch({ type: "SNAPSHOT_SET", snapshot: data });
  }, [refetchSnapshot, hasPendingWrites]);
  const applyRef = useRef(applyRemoteSnapshot);
  useEffect(() => {
    applyRef.current = applyRemoteSnapshot;
  });
  useEffect(() => {
    coordinatorRef.current = createRefetchCoordinator(() => void applyRef.current());
  }, []);
  useOntologyRealtime(workspaceId, () =>
    coordinatorRef.current?.request(hasPendingWrites())
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      // Flush, not drop: edits inside the debounce window must survive
      // navigating away.
      for (const [key, timer] of timers) {
        clearTimeout(timer);
        if (key.startsWith("cluster:")) {
          const cluster = graphRef.current.clusters.find(
            (c) => c.id === key.slice("cluster:".length)
          );
          if (cluster) {
            void api
              .updateCluster(workspaceId, cluster.id, {
                name: cluster.name || "Untitled",
                purpose: cluster.purpose,
              })
              .catch(() => undefined);
          }
        } else {
          const object = graphRef.current.objects[key];
          if (object) {
            void api
              .updateObject(workspaceId, key, {
                name: object.name || "Untitled",
                subtitle: object.subtitle,
                attributes: object.attributes,
                methods: object.methods,
                relationships: object.relationships,
                template: object.template,
              })
              .catch(() => undefined);
          }
        }
      }
      timers.clear();
    };
  }, [workspaceId]);

  // ⚠ Every mirrored write (debounced PATCH + create sequences) must bracket
  // itself with these, so a remote snapshot can't re-seed the reducer on top of
  // a row whose POST hasn't answered.
  const beginWrite = useCallback(() => {
    inFlightRef.current += 1;
  }, []);
  const endWrite = useCallback(() => {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1);
    coordinatorRef.current?.settle(hasPendingWrites());
  }, [hasPendingWrites]);

  const syncObject = useCallback(
    (objectId: string) => {
      const object = graphRef.current.objects[objectId];
      if (!object) return;
      beginWrite();
      api
        .updateObject(workspaceId, objectId, {
          name: object.name || "Untitled",
          subtitle: object.subtitle,
          attributes: object.attributes,
          methods: object.methods,
          relationships: object.relationships,
          template: object.template,
        })
        .catch((err) => reportSaveError("object", err))
        .finally(endWrite);
    },
    [workspaceId, beginWrite, endWrite]
  );

  const scheduleObjectSync = useCallback(
    (objectId: string) => {
      const timers = timersRef.current;
      const existing = timers.get(objectId);
      if (existing) clearTimeout(existing);
      timers.set(
        objectId,
        setTimeout(() => {
          timers.delete(objectId);
          syncObject(objectId);
        }, OBJECT_SYNC_DELAY_MS)
      );
    },
    [syncObject]
  );

  const scheduleClusterSync = useCallback(
    (clusterId: string) => {
      const timers = timersRef.current;
      const key = `cluster:${clusterId}`;
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          const cluster = graphRef.current.clusters.find((c) => c.id === clusterId);
          if (!cluster) return;
          beginWrite();
          api
            .updateCluster(workspaceId, clusterId, {
              name: cluster.name || "Untitled",
              purpose: cluster.purpose,
            })
            .catch((err) => reportSaveError("cluster", err))
            .finally(endWrite);
        }, OBJECT_SYNC_DELAY_MS)
      );
    },
    [workspaceId, beginWrite, endWrite]
  );

  // Undo a refused delete by merging the removed slice into the board as it
  // looks NOW. Without it the row lives server-side while the board shows it
  // gone, and `dirtyRef` blocks re-seeds until the next mount.
  const rollbackDelete = useCallback((before: GraphState, action: GraphAction) => {
    const snapshot = planDeleteRollback(before, graphRef.current, action);
    if (snapshot) rawDispatch({ type: "SNAPSHOT_SET", snapshot });
  }, []);

  const dispatch = useCallback(
    (action: GraphAction) => {
      // ⚠ Captured BEFORE the reducer runs: rollback source, and the state the
      // cluster cascade's pending-timer keys are read from.
      const before = graphRef.current;
      const removedClusterObjectIds =
        action.type === "CLUSTER_DELETE" ? clusterObjectIds(before, action.id) : [];
      dirtyRef.current = true;
      rawDispatch(action);
      const objectId = objectIdToSync(action);
      if (objectId) scheduleObjectSync(objectId);
      if (action.type === "CLUSTER_UPDATE") scheduleClusterSync(action.id);
      if (action.type === "OBJECT_DELETE") {
        const timer = timersRef.current.get(action.id);
        if (timer) clearTimeout(timer);
        timersRef.current.delete(action.id);
        // ⚠ Two-arg `then`, not `.then().catch()`: a throw out of the caller's
        // onDeleted must not read as a refused DELETE and roll back a delete
        // that actually landed.
        void api.deleteObject(workspaceId, action.id).then(
          () => optionsRef.current.onDeleted?.(),
          (err: unknown) => {
            rollbackDelete(before, action);
            reportSaveError("delete", err);
          }
        );
      }
      if (action.type === "CLUSTER_DELETE") {
        const timers = timersRef.current;
        for (const key of [`cluster:${action.id}`, ...removedClusterObjectIds]) {
          const timer = timers.get(key);
          if (timer) clearTimeout(timer);
          timers.delete(key);
        }
        void api.deleteCluster(workspaceId, action.id).then(
          () => optionsRef.current.onDeleted?.(),
          (err: unknown) => {
            rollbackDelete(before, action);
            reportSaveError("delete cluster", err);
          }
        );
      }
    },
    [workspaceId, scheduleObjectSync, scheduleClusterSync, rollbackDelete]
  );

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);
  const getObject = useCallback(
    (id: string): OntologyObject | undefined => graphRef.current.objects[id],
    []
  );
  const { createCluster, createObject, pendingIds } = useOntologyCreates({
    workspaceId,
    dispatch: rawDispatch,
    markDirty,
    beginWrite,
    endWrite,
    getObject,
    callbacks: optionsRef,
    reportError: reportSaveError,
  });

  return { graph, status, dispatch, createCluster, createObject, pendingIds };
}

function reportSaveError(what: string, err: unknown): void {
  toast({
    title: `Couldn't save ${what}`,
    description: err instanceof Error ? err.message : "Unknown error",
  });
}
