"use client";

/**
 * Supabase Realtime Presence for "who's here" on one shared resource. Each open
 * editor tracks `{ userId, displayName, avatarUrl, editing }` on a per-resource
 * channel; returns the deduped list of present users.
 *
 * `editing` re-tracks live without tearing down the channel. ⚠ Best-effort UI —
 * RLS still governs the underlying data.
 */

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import type { CurrentProfile } from "@/shared/auth/use-current-profile";
import { isSpaRenderer } from "@/shared/lib/spa-bridge";

export interface PresencePeer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  editing: boolean;
}

type TrackedPayload = PresencePeer;

export function usePresence(
  topic: string | null,
  self: CurrentProfile | null,
  editing: boolean
): PresencePeer[] {
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  });

  // ⚠ Re-track on editing change without teardown. Excluded from the subscribe
  // effect's deps below.
  useEffect(() => {
    const ch = channelRef.current;
    if (ch && self) {
      void ch.track({
        userId: self.userId,
        displayName: self.displayName,
        avatarUrl: self.avatarUrl,
        editing,
      } satisfies TrackedPayload);
    }
  }, [editing, self]);

  useEffect(() => {
    if (!topic || !self) return;
    // Bundled SPA: no Supabase client in the renderer (no network by design) —
    // presence degrades to "just me", same policy as shared-channel-registry.
    if (isSpaRenderer()) return;
    const selfSnapshot = self;
    const supabase = getSupabaseBrowser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel: any = supabase.channel(topic, {
      config: { presence: { key: selfSnapshot.userId } },
    });
    channelRef.current = channel;

    function syncPeers() {
      const state = channel.presenceState() as Record<string, TrackedPayload[]>;
      const byUser = new Map<string, PresencePeer>();
      for (const entries of Object.values(state)) {
        for (const p of entries) {
          if (!p?.userId) continue;
          const prev = byUser.get(p.userId);
          // Dedupe a user's tabs into one avatar; editing in ANY tab counts.
          byUser.set(p.userId, {
            userId: p.userId,
            displayName: p.displayName,
            avatarUrl: p.avatarUrl ?? null,
            editing: (prev?.editing ?? false) || !!p.editing,
          });
        }
      }
      setPeers([...byUser.values()]);
    }

    channel
      .on("presence", { event: "sync" }, syncPeers)
      .on("presence", { event: "join" }, syncPeers)
      .on("presence", { event: "leave" }, syncPeers)
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            userId: selfSnapshot.userId,
            displayName: selfSnapshot.displayName,
            avatarUrl: selfSnapshot.avatarUrl,
            editing: editingRef.current,
          } satisfies TrackedPayload);
        }
      });

    // ⚠ React unmount never runs on tab close / bfcache navigation, so without
    // this a closed tab leaves a phantom presence until the socket heartbeat
    // reaps it. `pagehide` (not `beforeunload`) covers both.
    function handlePageHide() {
      try {
        void channel.untrack();
      } catch {
        // Socket already gone — server-side reap handles it.
      }
    }
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      channelRef.current = null;
      try {
        void channel.untrack();
        supabase.removeChannel(channel);
      } catch {
        // Already torn down.
      }
      setPeers([]);
    };
    // ⚠ `editing` is intentionally NOT a dep (the re-track effect above owns
    // it), so a keystroke-driven dirty flip never resubscribes.
  }, [topic, self]);

  return peers;
}
