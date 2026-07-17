"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createRefetchCoordinator,
  type RefetchCoordinator,
} from "@/shared/realtime/refetch-coordinator";
import { toast } from "@/shared/ui/toast";
import * as api from "../client/api";
import { planClusterCreateRollback } from "../create-cluster-rollback";
import { useOntologyRealtime } from "../client/realtime";
import {
  clusterObjectIds,
  EMPTY_GRAPH,
  graphReducer,
  objectIdToSync,
  type GraphAction,
  type GraphState,
} from "../graph-state";
import type { OntologyCluster, OntologyObject } from "../types";

const OBJECT_SYNC_DELAY_MS = 800;

/** TanStack key for the workspace ontology snapshot — exported so a sibling
 *  (the graph view's layout-persist error path) can invalidate it. */
export const ontologySnapshotKey = (workspaceId: string) =>
  ["ontology-snapshot", workspaceId] as const;

export type OntologyStatus = "loading" | "ready" | "error";

/**
 * The ontology store with persistence: loads the workspace snapshot,
 * applies actions optimistically, and mirrors them to the API —
 * object edits debounced per object (full-state PATCH, idempotent),
 * deletes immediately, creates server-first so ids are real.
 *
 * `onOverCap` fires when a create is denied by the free object cap
 * (server returns `over_free_cap`): the caller opens the upgrade modal
 * instead of surfacing a generic save-error toast.
 */
export function useOntology(
  workspaceId: string,
  onOverCap?: () => void
): {
  graph: GraphState;
  status: OntologyStatus;
  dispatch: (action: GraphAction) => void;
  createCluster: () => Promise<OntologyCluster | null>;
  createObject: (
    target: { clusterId: string } | { parentObjectId: string }
  ) => Promise<OntologyObject | null>;
} {
  const [graph, rawDispatch] = useReducer(graphReducer, EMPTY_GRAPH);
  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  // Ref so create callbacks stay stable across renders even when the
  // caller passes an inline handler.
  const onOverCapRef = useRef(onOverCap);
  useEffect(() => {
    onOverCapRef.current = onOverCap;
  }, [onOverCap]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Debounced PATCHes that have fired and are awaiting their server round
  // trip. Combined with `timersRef.size`, this is the "writes in flight"
  // signal the realtime refetch defers on (see hasPendingWrites).
  const inFlightRef = useRef(0);

  // Snapshot through the query cache: a revisit paints instantly from the
  // cached graph while a background refetch brings it current. Focus
  // refetch stays OFF — the reducer holds optimistic edits and a surprise
  // SNAPSHOT_SET mid-edit would clobber them.
  const snapshotQuery = useQuery({
    queryKey: ontologySnapshotKey(workspaceId),
    queryFn: () => api.fetchSnapshot(workspaceId),
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    staleTime: 0,
  });

  // Seed/refresh the reducer from query data — but never over local edits:
  // once the user has dispatched anything, later refetch results are
  // ignored (the debounced writes own persistence; next mount refetches).
  const dirtyRef = useRef(false);
  const seededRef = useRef(false);
  // `seeded` mirrors seededRef as state: status must track when the
  // REDUCER has the snapshot, not when the query cache does — a cached
  // revisit is "ready" only after the seed effect dispatches, otherwise
  // the empty-graph frame flashes the "create your first cluster" CTA.
  const [seeded, setSeeded] = useState(false);
  const snapshot = snapshotQuery.data;
  useEffect(() => {
    dirtyRef.current = false;
    seededRef.current = false;
    // One-shot flag reset on workspace switch, not a render-loop risk —
    // same sanctioned pattern as connect-agent-banner's mount read.
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

  // Seeded wins over error: a failed background refetch (e.g. reconnect)
  // must not blank a working — possibly mid-edit — board into the error
  // screen. "error" is only reachable before the first successful load.
  const status: OntologyStatus = seeded
    ? "ready"
    : snapshotQuery.error
      ? "error"
      : "loading";

  // ── Live updates from MCP/CLI agents and other tabs ────────────────
  // A remote change refetches the snapshot and re-seeds the reducer —
  // bypassing the seed effect's permanent dirty-guard, which exists to
  // stop a background refetch from clobbering local edits. The clobber
  // risk is real, so we never apply a remote snapshot while a local write
  // is in flight: the coordinator defers until debounced PATCHes have both
  // fired AND returned (hasPendingWrites), then applies the coalesced
  // refetch. Own edits echo back as events too — matching knowledge, the
  // resulting self-refetch is harmless (idempotent re-seed).
  const refetchSnapshot = snapshotQuery.refetch;
  const hasPendingWrites = useCallback(
    () => timersRef.current.size > 0 || inFlightRef.current > 0,
    []
  );
  const coordinatorRef = useRef<RefetchCoordinator | null>(null);
  const applyRemoteSnapshot = useCallback(async () => {
    const { data } = await refetchSnapshot();
    if (!data) return;
    // A write may have started during the fetch — re-defer rather than
    // overwrite the fresher local edit.
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
      // Flush (not drop) pending debounced saves so edits made within
      // the debounce window survive navigating away.
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

  const syncObject = useCallback(
    (objectId: string) => {
      const object = graphRef.current.objects[objectId];
      if (!object) return;
      inFlightRef.current += 1;
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
        .finally(() => {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          coordinatorRef.current?.settle(hasPendingWrites());
        });
    },
    [workspaceId, hasPendingWrites]
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
          inFlightRef.current += 1;
          api
            .updateCluster(workspaceId, clusterId, {
              name: cluster.name || "Untitled",
              purpose: cluster.purpose,
            })
            .catch((err) => reportSaveError("cluster", err))
            .finally(() => {
              inFlightRef.current = Math.max(0, inFlightRef.current - 1);
              coordinatorRef.current?.settle(hasPendingWrites());
            });
        }, OBJECT_SYNC_DELAY_MS)
      );
    },
    [workspaceId, hasPendingWrites]
  );

  const dispatch = useCallback(
    (action: GraphAction) => {
      const removedClusterObjectIds =
        action.type === "CLUSTER_DELETE" ? clusterObjectIds(graphRef.current, action.id) : [];
      dirtyRef.current = true;
      rawDispatch(action);
      const objectId = objectIdToSync(action);
      if (objectId) scheduleObjectSync(objectId);
      if (action.type === "CLUSTER_UPDATE") scheduleClusterSync(action.id);
      if (action.type === "OBJECT_DELETE") {
        const timer = timersRef.current.get(action.id);
        if (timer) clearTimeout(timer);
        timersRef.current.delete(action.id);
        api.deleteObject(workspaceId, action.id).catch((err) => reportSaveError("delete", err));
      }
      if (action.type === "CLUSTER_DELETE") {
        const timers = timersRef.current;
        for (const key of [`cluster:${action.id}`, ...removedClusterObjectIds]) {
          const timer = timers.get(key);
          if (timer) clearTimeout(timer);
          timers.delete(key);
        }
        api
          .deleteCluster(workspaceId, action.id)
          .catch((err) => reportSaveError("delete cluster", err));
      }
    },
    [workspaceId, scheduleObjectSync, scheduleClusterSync]
  );

  const createCluster = useCallback(async (): Promise<OntologyCluster | null> => {
    // Tracks whether the cluster POST landed — the guard for rollback: a later
    // seed POST that fails leaves an orphan cluster to undo (F-031).
    let createdClusterId: string | null = null;
    try {
      dirtyRef.current = true;
      const cluster = await api.createCluster(workspaceId, { name: "New cluster" });
      createdClusterId = cluster.id;
      rawDispatch({ type: "CLUSTER_ADD", cluster });
      const column = await api.createObject(workspaceId, {
        clusterId: cluster.id,
        name: "Untitled column",
      });
      rawDispatch({ type: "OBJECT_ADD", object: column, clusterId: cluster.id });
      const card = await api.createObject(workspaceId, {
        parentObjectId: column.id,
        name: "New object",
      });
      rawDispatch({ type: "OBJECT_ADD", object: card, parentObjectId: column.id });
      return cluster;
    } catch (err) {
      // Undo a half-created cluster before surfacing the error: drop the
      // orphan from local state and best-effort delete it server-side so no
      // ghost unseeded tab or orphan row survives the partial failure.
      const plan = planClusterCreateRollback(createdClusterId);
      if (plan.rollback) {
        rawDispatch({ type: "CLUSTER_DELETE", id: plan.clusterId });
        void api.deleteCluster(workspaceId, plan.clusterId).catch(() => undefined);
      }
      if (api.isOverFreeCapError(err)) onOverCapRef.current?.();
      else reportSaveError("create cluster", err);
      return null;
    }
  }, [workspaceId]);

  const createObject = useCallback(
    async (
      target: { clusterId: string } | { parentObjectId: string }
    ): Promise<OntologyObject | null> => {
      const isColumn = "clusterId" in target;
      try {
        dirtyRef.current = true;
        const object = await api.createObject(workspaceId, {
          ...target,
          name: isColumn ? "Untitled column" : "New object",
        });
        rawDispatch({ type: "OBJECT_ADD", object, ...target });
        return object;
      } catch (err) {
        if (api.isOverFreeCapError(err)) onOverCapRef.current?.();
        else reportSaveError("create object", err);
        return null;
      }
    },
    [workspaceId]
  );

  return { graph, status, dispatch, createCluster, createObject };
}

function reportSaveError(what: string, err: unknown): void {
  toast({
    title: `Couldn't save ${what}`,
    description: err instanceof Error ? err.message : "Unknown error",
  });
}
