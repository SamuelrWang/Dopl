"use client";

/**
 * use-clusters-realtime.ts — subscribe to Supabase realtime on the
 * `clusters` table so the canvas reflects MCP-agent edits without a
 * page reload.
 *
 * Coverage today:
 *   - clusters: UPDATE (rename) and DELETE → live cluster header rename,
 *     live cluster outline disappear. INSERT is a hard problem (we'd
 *     need to construct a Cluster object with panelIds from one row;
 *     we don't have that mapping locally) — the user reloads to see
 *     brand-new agent-created clusters for now.
 *
 * Reconnect: a watchdog re-subscribes on `CHANNEL_ERROR` / `TIMED_OUT`
 * / `CLOSED` with capped exponential backoff.
 */

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { useCanvas, useCanvasScope } from "./canvas-store";

type ClustersRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description?: string | null;
};

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

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let activeChannel: any = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    function findClusterByDbId(dbId: string) {
      return stateRef.current.clusters.find((c) => c.dbId === dbId) ?? null;
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
              if (
                cluster.name !== payload.new.name ||
                (cluster.description ?? null) !==
                  (payload.new.description ?? null)
              ) {
                dispatch({
                  type: "UPDATE_CLUSTER_INFO",
                  clusterId: cluster.id,
                  name: payload.new.name,
                  description: payload.new.description ?? null,
                });
              }
              // Renames regenerate the slug server-side. Without syncing
              // it, every slug-keyed call (info-panel PATCH, attachment
              // ops) 404s until reload.
              if (cluster.slug !== payload.new.slug) {
                dispatch({
                  type: "UPDATE_CLUSTER_DB_INFO",
                  clusterId: cluster.id,
                  dbId: payload.new.id,
                  slug: payload.new.slug,
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
        .subscribe((status: ChannelStatus) => {
          if (cancelled) return;

          if (status === "SUBSCRIBED") {
            reconnectAttempt = 0;
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
