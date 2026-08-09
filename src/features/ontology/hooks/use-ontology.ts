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

/** TanStack key for the workspace ontology snapshot — exported so a sibling
 *  (the graph view's layout-persist error path) can invalidate it. */
export const ontologySnapshotKey = (workspaceId: string) =>
  ["ontology-snapshot", workspaceId] as const;

export type OntologyStatus = "loading" | "ready" | "error";

export interface UseOntologyOptions extends OntologyCreateCallbacks {
  /** An object or cluster was permanently deleted ON THE SERVER. The object
   *  cap is a server-side count, and since deletes went permanent this is the
   *  only way back under a cap — so the caller refreshes entitlements here or
   *  its cap meter (and the create short-circuit reading `overCap`) stays
   *  stuck at the pre-delete number until a reload. */
  onDeleted?: () => void;
}

/**
 * The ontology store with persistence: loads the workspace snapshot,
 * applies actions optimistically, and mirrors them to the API —
 * object edits debounced per object (full-state PATCH, idempotent), deletes
 * immediately, and creates optimistically too since 2026-08-08 (the row is
 * dispatched with a provisional id before the POST leaves, and
 * `CREATE_RESOLVE` swaps in the server's id when it answers —
 * `optimistic-create.ts`). A delete the server refuses is rolled back into the
 * reducer (see `delete-rollback.ts`); so is a create.
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
  // Ref so the create/delete callbacks stay stable across renders even when
  // the caller passes an inline handler (or a fresh options literal).
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
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

  // One write in flight, from the realtime coordinator's point of view. Every
  // mirrored write — debounced PATCH, and now the create sequences — brackets
  // itself with these, so a remote snapshot can never re-seed the reducer on
  // top of a row whose POST has not answered yet.
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

  // Undo an optimistic delete the server refused, merging the removed slice
  // back into whatever the board looks like NOW. Without this the row stays
  // live server-side while the board shows it gone — and the `dirtyRef` this
  // same dispatch set means no refetch can re-seed the reducer for the rest
  // of the session, so the divergence hides until the next mount.
  const rollbackDelete = useCallback((before: GraphState, action: GraphAction) => {
    const snapshot = planDeleteRollback(before, graphRef.current, action);
    if (snapshot) rawDispatch({ type: "SNAPSHOT_SET", snapshot });
  }, []);

  const dispatch = useCallback(
    (action: GraphAction) => {
      // Captured BEFORE the reducer runs: the rollback source, and the state
      // the cluster cascade's pending-timer keys are read from.
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
        // Two-arg `then`, not `.then().catch()`: a throw out of the caller's
        // onDeleted must never be mistaken for a refused DELETE and roll back
        // a delete that actually landed.
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
