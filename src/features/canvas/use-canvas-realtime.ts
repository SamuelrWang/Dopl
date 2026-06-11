"use client";

/**
 * useCanvasRealtime — subscribe to Supabase Realtime on `canvas_panels` +
 * `canvas_edges` for the active workspace and apply other writers' changes
 * (notably an MCP agent authoring a workflow) into the canvas reducer live.
 *
 * Scope: only `node` + `workflow` panels are applied (the workflow-authoring
 * surface). Chat/KB/skill panels are left to their own syncs — replacing a
 * chat panel here would wipe its in-memory messages.
 *
 * Loop safety: the write-through db-sync re-emits at most one idempotent
 * (UPSERT) write per applied remote change, then quiesces — its effects only
 * fire on a content diff vs their prev-refs. The reducer's APPLY_REMOTE_*
 * actions are idempotent and skip a panel the user has selected (mid-drag /
 * editing), so a debounced echo can't snap it back.
 *
 * Pattern (channel + capped-backoff reconnect) mirrors
 * `knowledge/client/realtime.ts`. RLS applies — the browser client connects
 * under the user's auth, so events are filtered to readable rows.
 */

import { useEffect, useId } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { useCanvas, useCanvasScope } from "./canvas-store";
import { dbRowToPanel } from "./server/panel-dto";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];
type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

type PanelRow = Record<string, unknown> & { panel_type?: string; panel_id?: string };
type EdgeRow = { id?: string; from_panel_id?: string; to_panel_id?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: any; old: any };

const APPLIED_TYPES = new Set(["node", "workflow"]);

export function useCanvasRealtime(): void {
  const { dispatch } = useCanvas();
  const scope = useCanvasScope();
  const workspaceId = scope?.workspaceId ?? null;
  const instanceId = useId();

  useEffect(() => {
    if (!workspaceId) return;
    const wsId = workspaceId;
    const supabase = getSupabaseBrowser();

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let activeChannel: any = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    function scheduleReconnect() {
      if (cancelled || reconnectTimer) return;
      const delay =
        RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectAttempt += 1;
        connect();
      }, delay);
    }

    function onPanel(payload: Payload) {
      if (cancelled) return;
      if (payload.eventType === "DELETE") {
        const old = payload.old as PanelRow;
        if (old?.panel_id && (!old.panel_type || APPLIED_TYPES.has(old.panel_type))) {
          dispatch({ type: "APPLY_REMOTE_PANEL_REMOVE", panelId: old.panel_id });
        }
        return;
      }
      const row = payload.new as PanelRow;
      if (!row || !APPLIED_TYPES.has(row.panel_type ?? "")) return;
      const panel = dbRowToPanel(row);
      if (panel) dispatch({ type: "APPLY_REMOTE_PANEL_UPSERT", panel });
    }

    function onEdge(payload: Payload) {
      if (cancelled) return;
      if (payload.eventType === "DELETE") {
        const old = payload.old as EdgeRow;
        if (old?.id) dispatch({ type: "APPLY_REMOTE_EDGE_REMOVE", edgeId: old.id });
        return;
      }
      const row = payload.new as EdgeRow;
      if (row?.id && row.from_panel_id && row.to_panel_id) {
        dispatch({
          type: "APPLY_REMOTE_EDGE_UPSERT",
          edge: { id: row.id, fromPanelId: row.from_panel_id, toPanelId: row.to_panel_id },
        });
      }
    }

    function connect() {
      if (cancelled) return;
      if (activeChannel) {
        try {
          supabase.removeChannel(activeChannel);
        } catch {
          /* already torn down */
        }
        activeChannel = null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chan = supabase.channel(`canvas-realtime-${wsId}-${instanceId}`) as any;
      const channel = chan
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "canvas_panels", filter: `workspace_id=eq.${wsId}` },
          onPanel
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "canvas_edges", filter: `workspace_id=eq.${wsId}` },
          onEdge
        )
        .subscribe((status: ChannelStatus) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            reconnectAttempt = 0;
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            scheduleReconnect();
          }
        });
      activeChannel = channel;
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeChannel) {
        try {
          supabase.removeChannel(activeChannel);
        } catch {
          /* ignore */
        }
      }
    };
  }, [workspaceId, instanceId, dispatch]);
}
