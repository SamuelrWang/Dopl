"use client";

/**
 * useWorkspaceTablesRealtime — subscribe to Supabase Realtime
 * postgres_changes on a set of workspace-scoped tables. Fires `onChange`
 * on every INSERT/UPDATE/DELETE so the caller can refetch.
 *
 * Single implementation behind useKnowledgeRealtime / useSkillsRealtime:
 * capped exponential backoff on disconnect, refetch on each fresh
 * SUBSCRIBED so events fired during the disconnect window aren't lost.
 * RLS still applies — the client connects under the user's auth, so the
 * server filters events to rows the user can read.
 */

import { useEffect, useId, useRef } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export function useWorkspaceTablesRealtime(
  workspaceId: string | null | undefined,
  /** Table names to watch; each is filtered by `workspace_id=eq.<id>`.
   *  Pass a stable (module-level) array — a new array per render resubscribes. */
  tables: readonly string[],
  /** Channel topic prefix, e.g. "knowledge-realtime". */
  topicPrefix: string,
  onChange: () => void
): void {
  // Latest onChange in a ref so the effect captures the freshest
  // closure without resubscribing on every render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Per-instance channel topic. Multiple components can mount this hook
  // for the same workspaceId. If we used a shared topic name, the second
  // subscriber's `.on(...)` calls would arrive AFTER the first
  // subscriber's `.subscribe()`, and Supabase v2 throws — taking down
  // the page. Including React's stable per-instance id keeps each
  // subscriber on its own topic.
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
        RECONNECT_DELAYS_MS[
          Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
        ];
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectAttempt += 1;
        connect();
      }, delay);
    }

    function fire() {
      if (cancelled) return;
      onChangeRef.current();
    }

    function connect() {
      if (cancelled) return;
      if (activeChannel) {
        try {
          supabase.removeChannel(activeChannel);
        } catch {
          // Already torn down.
        }
        activeChannel = null;
      }

      // The Supabase JS .on("postgres_changes", …) handler signature is
      // loosely typed at runtime — cast through any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let chan = supabase.channel(`${topicPrefix}-${wsId}-${instanceId}`) as any;

      for (const table of tables) {
        chan = chan.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `workspace_id=eq.${wsId}`,
          },
          fire
        );
      }

      const channel = chan.subscribe((status: ChannelStatus) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          // Healthy. Refetch on first connect so any events that fired
          // during the disconnect window (or before mount) are picked up.
          reconnectAttempt = 0;
          fire();
          return;
        }
        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
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
    // `tables` is expected to be module-level constant; joining keeps the
    // dep primitive so an accidentally-inline array still behaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, instanceId, topicPrefix, tables.join(",")]);
}
