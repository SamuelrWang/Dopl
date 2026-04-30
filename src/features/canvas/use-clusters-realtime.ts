"use client";

/**
 * use-clusters-realtime.ts — subscribe to Supabase realtime on the
 * `clusters`, `cluster_brains`, and `cluster_brain_memories` tables so
 * the canvas reflects MCP-agent edits without a page reload.
 *
 * Coverage today:
 *   - clusters: UPDATE (rename) and DELETE → live cluster header rename,
 *     live cluster outline disappear. INSERT is a hard problem (we'd
 *     need to construct a Cluster object with panelIds from one row;
 *     we don't have that mapping locally) — logged as a TODO; the user
 *     reloads to see brand-new agent-created clusters for now.
 *   - cluster_brains: INSERT and UPDATE → live brain instructions update
 *     in the brain panel.
 *   - cluster_brain_memories: any event → refetch the cluster's full
 *     memories list and replace atomically.
 *
 * Reconnect: a watchdog re-subscribes on `CHANNEL_ERROR` / `TIMED_OUT`
 * / `CLOSED` with capped exponential backoff. The first SUBSCRIBED on
 * a fresh channel triggers a memories refetch so events that fired
 * during the disconnect window are picked up.
 */

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { useCanvas, useCanvasScope } from "./canvas-store";

type ClustersRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
};

type BrainRow = {
  id: string;
  cluster_id: string;
  workspace_id: string;
  instructions: string;
};

type MemoryRow = {
  id: string;
  cluster_brain_id: string;
  cluster_id: string;
  workspace_id: string;
  content: string;
};

const BRAIN_TEXT_DEBOUNCE_MS = 150;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export function useClustersRealtime() {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const workspaceId = scope?.workspaceId ?? null;

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!workspaceId) return;
    const wsId: string = workspaceId;

    const supabase = getSupabaseBrowser();
    const brainTextDebouncers = new Map<string, ReturnType<typeof setTimeout>>();

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let activeChannel: any = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    function findClusterByDbId(dbId: string) {
      return stateRef.current.clusters.find((c) => c.dbId === dbId) ?? null;
    }

    function findBrainPanelByClusterDbId(clusterDbId: string) {
      const cluster = findClusterByDbId(clusterDbId);
      if (!cluster) return null;
      const expectedId = `brain-${clusterDbId}`;
      return (
        stateRef.current.panels.find(
          (p) => p.id === expectedId && p.type === "cluster-brain"
        ) ?? null
      );
    }

    async function refetchMemoriesForCluster(clusterDbId: string) {
      const cluster = findClusterByDbId(clusterDbId);
      if (!cluster?.slug) return;
      const brainPanel = findBrainPanelByClusterDbId(clusterDbId);
      if (!brainPanel) return;
      try {
        const res = await fetch(
          `/api/clusters/${encodeURIComponent(cluster.slug)}/brain`,
          {
            credentials: "include",
            headers: { "X-Workspace-Id": wsId },
          }
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          memories?: Array<{ content: string }>;
        };
        const memories = (body.memories ?? []).map((m) => m.content);
        dispatch({
          type: "SET_CLUSTER_BRAIN_MEMORIES",
          panelId: brainPanel.id,
          memories,
        });
      } catch {
        // Silent — a missed memory refresh just means the panel shows
        // the previous list until the next event or page reload.
      }
    }

    function scheduleReconnect() {
      if (cancelled || reconnectTimer) return;
      const delay =
        RECONNECT_DELAYS_MS[
          Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
        ];
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectAttempt++;
        connect();
      }, delay);
    }

    function connect() {
      if (cancelled) return;

      // Tear down any prior channel first — a CHANNEL_ERROR can leave
      // the old subscription registered, which then keeps emitting
      // dead-letter events that we'd handle alongside the live ones.
      if (activeChannel) {
        try {
          supabase.removeChannel(activeChannel);
        } catch {
          // Ignore — already torn down.
        }
        activeChannel = null;
      }

      // The Supabase JS .on("postgres_changes", …) overload is loosely
      // typed at runtime; cast through any so TS doesn't complain
      // about the handler signatures.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chan = supabase.channel(`workspace-realtime-${wsId}`) as any;

      const channel = chan
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "clusters",
            filter: `workspace_id=eq.${wsId}`,
          },
          (payload: {
            eventType: "INSERT" | "UPDATE" | "DELETE";
            new: ClustersRow | null;
            old: ClustersRow | null;
          }) => {
            if (payload.eventType === "INSERT") return;
            if (payload.eventType === "UPDATE" && payload.new) {
              const cluster = findClusterByDbId(payload.new.id);
              if (!cluster) return;
              if (cluster.name !== payload.new.name) {
                dispatch({
                  type: "UPDATE_CLUSTER_NAME",
                  clusterId: cluster.id,
                  name: payload.new.name,
                });
              }
              return;
            }
            if (payload.eventType === "DELETE" && payload.old) {
              const cluster = findClusterByDbId(payload.old.id);
              if (!cluster) return;
              dispatch({ type: "DELETE_CLUSTER", clusterId: cluster.id });
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "cluster_brains",
            filter: `workspace_id=eq.${wsId}`,
          },
          (payload: {
            eventType: "INSERT" | "UPDATE" | "DELETE";
            new: BrainRow | null;
            old: BrainRow | null;
          }) => {
            const row = payload.new ?? payload.old;
            if (!row) return;
            const brainPanel = findBrainPanelByClusterDbId(row.cluster_id);
            if (!brainPanel) return;
            if (
              payload.eventType === "INSERT" ||
              payload.eventType === "UPDATE"
            ) {
              const incoming = payload.new?.instructions ?? "";
              if (
                brainPanel.type === "cluster-brain" &&
                brainPanel.instructions === incoming
              ) {
                return;
              }
              const existing = brainTextDebouncers.get(row.cluster_id);
              if (existing) clearTimeout(existing);
              const timer = setTimeout(() => {
                brainTextDebouncers.delete(row.cluster_id);
                dispatch({
                  type: "UPDATE_CLUSTER_BRAIN_INSTRUCTIONS_TEXT",
                  panelId: brainPanel.id,
                  instructions: incoming,
                });
              }, BRAIN_TEXT_DEBOUNCE_MS);
              brainTextDebouncers.set(row.cluster_id, timer);
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "cluster_brain_memories",
            filter: `workspace_id=eq.${wsId}`,
          },
          (payload: {
            eventType: "INSERT" | "UPDATE" | "DELETE";
            new: MemoryRow | null;
            old: MemoryRow | null;
          }) => {
            const row = payload.new ?? payload.old;
            if (!row?.cluster_id) return;
            void refetchMemoriesForCluster(row.cluster_id);
          }
        )
        .subscribe((status: ChannelStatus) => {
          if (cancelled) return;

          if (status === "SUBSCRIBED") {
            // Healthy connection — reset backoff and refetch any
            // memories events we may have missed during the
            // disconnect window. Brain-text and cluster-rename
            // refreshes ride on the next live UPDATE; staleness until
            // then is acceptable since the panel won't be wrong, just
            // one revision behind.
            reconnectAttempt = 0;
            for (const c of stateRef.current.clusters) {
              if (c.dbId) void refetchMemoriesForCluster(c.dbId);
            }
            return;
          }

          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            // CLOSED also fires on intentional teardown via the
            // cleanup function — the `cancelled` guard inside
            // scheduleReconnect prevents reconnecting in that case.
            scheduleReconnect();
          }
        });

      activeChannel = channel;
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      for (const t of brainTextDebouncers.values()) clearTimeout(t);
      brainTextDebouncers.clear();
      if (activeChannel) {
        try {
          supabase.removeChannel(activeChannel);
        } catch {
          // Ignore.
        }
        activeChannel = null;
      }
    };
  }, [workspaceId, dispatch]);
}
