"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "@/shared/ui/toast";
import * as api from "../client/api";
import {
  EMPTY_GRAPH,
  graphReducer,
  objectIdToSync,
  type GraphAction,
  type GraphState,
} from "../graph-state";
import type { ObjectTypeId, OntologyCluster, OntologyObject } from "../types";

const OBJECT_SYNC_DELAY_MS = 800;

export type OntologyStatus = "loading" | "ready" | "error";

/**
 * The ontology store with persistence: loads the workspace snapshot,
 * applies actions optimistically, and mirrors them to the API —
 * object edits debounced per object (full-state PATCH, idempotent),
 * deletes immediately, creates server-first so ids are real.
 */
export function useOntology(workspaceId: string): {
  graph: GraphState;
  status: OntologyStatus;
  dispatch: (action: GraphAction) => void;
  createCluster: () => Promise<OntologyCluster | null>;
  createObject: (
    target: { clusterId: string } | { parentObjectId: string },
    objectType: ObjectTypeId
  ) => Promise<OntologyObject | null>;
} {
  const [graph, rawDispatch] = useReducer(graphReducer, EMPTY_GRAPH);
  const [status, setStatus] = useState<OntologyStatus>("loading");
  const graphRef = useRef(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let cancelled = false;
    api
      .fetchSnapshot(workspaceId)
      .then((snapshot) => {
        if (cancelled) return;
        rawDispatch({ type: "SNAPSHOT_SET", snapshot });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    const timers = timersRef.current;
    return () => {
      cancelled = true;
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
                objectType: object.type,
                attributes: object.attributes,
                methods: object.methods,
                relationships: object.relationships,
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
      api
        .updateObject(workspaceId, objectId, {
          name: object.name || "Untitled",
          subtitle: object.subtitle,
          objectType: object.type,
          attributes: object.attributes,
          methods: object.methods,
          relationships: object.relationships,
        })
        .catch((err) => reportSaveError("object", err));
    },
    [workspaceId]
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
          api
            .updateCluster(workspaceId, clusterId, {
              name: cluster.name || "Untitled",
              purpose: cluster.purpose,
            })
            .catch((err) => reportSaveError("cluster", err));
        }, OBJECT_SYNC_DELAY_MS)
      );
    },
    [workspaceId]
  );

  const dispatch = useCallback(
    (action: GraphAction) => {
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
    },
    [workspaceId, scheduleObjectSync, scheduleClusterSync]
  );

  const createCluster = useCallback(async (): Promise<OntologyCluster | null> => {
    try {
      const cluster = await api.createCluster(workspaceId, { name: "New cluster" });
      rawDispatch({ type: "CLUSTER_ADD", cluster });
      const column = await api.createObject(workspaceId, {
        clusterId: cluster.id,
        objectType: "person",
        name: "Untitled column",
      });
      rawDispatch({ type: "OBJECT_ADD", object: column, clusterId: cluster.id });
      const card = await api.createObject(workspaceId, {
        parentObjectId: column.id,
        objectType: "person",
        name: "New object",
      });
      rawDispatch({ type: "OBJECT_ADD", object: card, parentObjectId: column.id });
      return cluster;
    } catch (err) {
      reportSaveError("create cluster", err);
      return null;
    }
  }, [workspaceId]);

  const createObject = useCallback(
    async (
      target: { clusterId: string } | { parentObjectId: string },
      objectType: ObjectTypeId
    ): Promise<OntologyObject | null> => {
      const isColumn = "clusterId" in target;
      try {
        const object = await api.createObject(workspaceId, {
          ...target,
          objectType,
          name: isColumn ? "Untitled column" : "New object",
        });
        rawDispatch({ type: "OBJECT_ADD", object, ...target });
        return object;
      } catch (err) {
        reportSaveError("create object", err);
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
