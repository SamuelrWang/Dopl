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
 *     memories list and replace atomically. Canvas state stores
 *     memories as plain strings (no IDs), so we can't apply per-event
 *     index math; refetch-and-replace keeps the local view consistent.
 *
 * Scale considerations:
 *   - One channel per user covering all three tables (one websocket).
 *   - Filtered by `user_id=eq.<userId>` at the publication so users
 *     only receive their own events (security + bandwidth).
 *   - Echo-suppressed: incoming text/state is compared against current
 *     panel content; identical payloads are dropped so the local
 *     reducer (e.g. brain editor) doesn't re-render after its own
 *     write echoes back through realtime.
 *   - Per-cluster debounce on the brain-text refresh: rapid
 *     surgical-edit bursts collapse into one dispatch within 150ms.
 *   - On channel reconnect, refetch all known cluster brains once to
 *     recover any events missed during the disconnect window.
 */

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { useCanvas } from "./canvas-store";

type ClustersRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
};

type BrainRow = {
  id: string;
  cluster_id: string;
  user_id: string;
  instructions: string;
};

type MemoryRow = {
  id: string;
  cluster_brain_id: string;
  cluster_id: string;
  user_id: string;
  content: string;
};

const BRAIN_TEXT_DEBOUNCE_MS = 150;

export function useClustersRealtime() {
  const { state, dispatch } = useCanvas();

  // Stable refs so the channel doesn't re-subscribe on every state
  // change (the dispatch identity is stable; state is not). The handler
  // closures read from these refs instead of capturing state directly.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let unsub = () => {};
    let cancelled = false;
    const brainTextDebouncers = new Map<string, ReturnType<typeof setTimeout>>();

    // Helpers — resolve a realtime payload's UUIDs to local canvas
    // state. Refs are read fresh on each event.
    function findClusterByDbId(dbId: string) {
      return stateRef.current.clusters.find((c) => c.dbId === dbId) ?? null;
    }

    function findBrainPanelByClusterDbId(clusterDbId: string) {
      const cluster = findClusterByDbId(clusterDbId);
      if (!cluster) return null;
      // Brain panels are inserted with id = `brain-<cluster.dbId>` by
      // both the MCP-create path (clusters/service.ts) and the canvas
      // selection-menu path. We could lookup via panelIds + type
      // filter, but the prefix match is faster and tolerates the rare
      // case where the brain panel hasn't been added to the cluster's
      // panelIds yet (e.g. during initial hydration).
      const expectedId = `brain-${clusterDbId}`;
      return (
        stateRef.current.panels.find(
          (p) => p.id === expectedId && p.type === "cluster-brain"
        ) ?? null
      );
    }

    // Refetch the brain memories for one cluster and dispatch a
    // SET_CLUSTER_BRAIN_MEMORIES with the canonical list. Used as the
    // single response to all memory events — INSERT/UPDATE/DELETE all
    // collapse into "show me the current truth."
    async function refetchMemoriesForCluster(clusterDbId: string) {
      const cluster = findClusterByDbId(clusterDbId);
      if (!cluster?.slug) return;
      const brainPanel = findBrainPanelByClusterDbId(clusterDbId);
      if (!brainPanel) return;
      try {
        const res = await fetch(
          `/api/clusters/${encodeURIComponent(cluster.slug)}/brain`,
          { credentials: "include" }
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

    supabase.auth
      .getUser()
      .then((res: { data: { user: { id: string } | null } }) => {
        if (cancelled) return;
        const userId = res.data.user?.id;
        if (!userId) return;

        // The Supabase JS .on("postgres_changes", …) overload is loosely
        // typed at runtime; cast through any so TS doesn't complain
        // about the handler signature.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chan = supabase.channel(`canvas-realtime-${userId}`) as any;

        const channel = chan
          // ── clusters ─────────────────────────────────────────────
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "clusters",
              filter: `user_id=eq.${userId}`,
            },
            (payload: {
              eventType: "INSERT" | "UPDATE" | "DELETE";
              new: ClustersRow | null;
              old: ClustersRow | null;
            }) => {
              if (payload.eventType === "INSERT") {
                // We can't reconstruct the cluster's panelIds from a
                // single clusters row — those live in canvas_state. The
                // create flow already updates that JSON server-side, so
                // a fresh page load shows the cluster correctly. Live
                // INSERT handling would require a parallel
                // canvas_state subscription or a soft refetch; deferred.
                return;
              }
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
          // ── cluster_brains ───────────────────────────────────────
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "cluster_brains",
              filter: `user_id=eq.${userId}`,
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
                // Echo-suppress: identical text means this is our own
                // write coming back. Skip to avoid a redundant dispatch
                // (which would re-trigger the brain editor's own save
                // flow if it's open).
                if (
                  brainPanel.type === "cluster-brain" &&
                  brainPanel.instructions === incoming
                ) {
                  return;
                }
                // Per-cluster debounce — agents doing multiple
                // surgical edits in a burst collapse into one render.
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
              // DELETE is rare for brains (they live as long as the
              // cluster); the cluster DELETE handler already removes
              // the cluster outline, and the brain panel goes with the
              // cluster's panelIds.
            }
          )
          // ── cluster_brain_memories ───────────────────────────────
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "cluster_brain_memories",
              filter: `user_id=eq.${userId}`,
            },
            (payload: {
              eventType: "INSERT" | "UPDATE" | "DELETE";
              new: MemoryRow | null;
              old: MemoryRow | null;
            }) => {
              const row = payload.new ?? payload.old;
              if (!row?.cluster_id) return;
              // All memory events collapse into "refetch the canonical
              // list and replace." Cheap (one GET, returns short
              // memory rows), and it sidesteps the canvas state's
              // missing memory-ID column.
              void refetchMemoriesForCluster(row.cluster_id);
            }
          )
          .subscribe(
            (status: "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED") => {
              // On (re)connect, refetch every known cluster's memory
              // list once so any events that fired during the
              // disconnect window are picked up. Brain text refresh is
              // covered by the same UPDATE channel — when the next
              // edit lands we'll catch it; missing the text update
              // until then is acceptable since the panel won't be
              // wrong, just stale by one revision.
              if (status === "SUBSCRIBED") {
                for (const c of stateRef.current.clusters) {
                  if (c.dbId) void refetchMemoriesForCluster(c.dbId);
                }
              }
            }
          );

        unsub = () => {
          for (const t of brainTextDebouncers.values()) clearTimeout(t);
          brainTextDebouncers.clear();
          supabase.removeChannel(channel);
        };
      });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [dispatch]);
}
