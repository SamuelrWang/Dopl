"use client";

/**
 * useSkillsRealtime — subscribe to Supabase Realtime on the `skills` and
 * `skill_files` tables for the active workspace. Mirrors
 * useKnowledgeRealtime: capped exponential backoff, refetch on each
 * fresh SUBSCRIBED so events fired during the disconnect window aren't
 * lost. RLS still applies — the client connects under the user's auth.
 */

import { useEffect, useRef } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

export function useSkillsRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chan = supabase.channel(`skills-realtime-${wsId}`) as any;

      const channel = chan
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "skills",
            filter: `workspace_id=eq.${wsId}`,
          },
          fire
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "skill_files",
            filter: `workspace_id=eq.${wsId}`,
          },
          fire
        )
        .subscribe((status: ChannelStatus) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
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
  }, [workspaceId]);
}
