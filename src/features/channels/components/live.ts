"use client";

/**
 * Channels — THE LIVE WIRING, as one hook: realtime → coalesced refetch, behind the
 * refetch coordinator every writer on the surface also holds.
 *
 * ⚠ SPLIT OUT OF `channels-core.tsx` ON 2026-08-18 (wiring plan Phase 10). That file was
 * within thirty lines of the 500-line cap, and this was the one block in it that is not
 * about the SURFACE at all — it is plumbing between the realtime doorbell and the five
 * feature reads. Nothing inside changed in the move; the core now names its refetches and
 * takes back the same `{ signal, gate }` pair it always built.
 *
 * ⚠ ONE COORDINATOR, BOTH ENDS (INVARIANTS §7/§8). `gate` goes to every writer on the page
 * — the composer's send, the Tags inbox's mark-read, the Inbox pane's consent decision, the
 * channel-management writes — and `signal` to the subscriptions. A remote event arriving
 * mid-send must not clobber the local optimistic patch, and a coordinator retrofitted after
 * the first write is a coordinator that was missing for exactly the window it was needed.
 *
 * ⚠ AN EVENT IS A DOORBELL, NEVER CONTENT. The signal triggers a filtered refetch and no
 * payload is ever merged, so RLS and the service filters stay authoritative. On the desktop
 * it is not even a websocket: `shared-channel-registry.ts › subscribeSharedWorkspaceTables`
 * takes its bridge branch and main's `ui-sync.js` rings the bell over IPC — and since the
 * Phase 10 fan-out that bell reaches every app window, the pop-out thread window included.
 */

import { useEffect, useRef } from "react";
import { useRefetchGate, type MutationGate } from "@/shared/hooks/use-api-mutation";
import { PRESENCE_REFETCH_DEBOUNCE_MS } from "../constants";
import { useChannelsRealtime, usePresenceRealtime } from "../client/realtime";

/** The one table whose events cannot change a transcript, thread or mention (TABLE-AWARE DOORBELL). */
const MEMBERS_TABLE = "channel_members";

/**
 * WHAT A COALESCED BATCH OF DOORBELLS INVALIDATES. `"roster"` only when EVERY signal in the batch
 * named `channel_members` — the read watermark (`last_read_at`), a join/leave, a favourite or a
 * role. Anything else, an unnamed catch-up (`null`), or an empty batch is `"all"`: the safe answer
 * is today's full refetch.
 */
export function doorbellScope(tables: ReadonlySet<string | null>): "roster" | "all" {
  if (tables.size === 0) return "all";
  for (const t of tables) if (t !== MEMBERS_TABLE) return "all";
  return "roster";
}

export function useChannelsLive({
  workspaceId,
  refetchAll,
  refetchMembers,
  refetchRoster,
}: {
  workspaceId: string;
  /** Everything a content change can invalidate — channels, messages, members, threads, mentions. */
  refetchAll: () => void;
  /** The ROSTER alone, for presence. */
  refetchMembers: () => void;
  /**
   * ⚠ TABLE-AWARE DOORBELL: what a `channel_members`-only batch refetches (the member roster and
   * the channel list's unread state). Absent, such a batch runs `refetchAll` as before. It exists
   * because the read watermark is a `channel_members` write: without it, every member with the
   * channel open re-read the whole transcript each time ANYONE opened that channel.
   */
  refetchRoster?: () => void;
}): { gate: MutationGate } {
  // ⚠ The refs are written in an EFFECT, not during render — the same shape
  // `use-api-mutation.ts › useRefetchGate` uses for its own `runRef`. A ref assigned in the
  // render pass is a `react-hooks/refs` error and, worse, is read by a subscription
  // callback that may fire before the render commits.
  const refetchRef = useRef<() => void>(() => {});
  const membersRefetchRef = useRef<() => void>(() => {});
  const rosterRefetchRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    refetchRef.current = refetchAll;
    membersRefetchRef.current = refetchMembers;
    rosterRefetchRef.current = refetchRoster;
  });

  // The tables named since the last run. The gate coalesces many signals into ONE run, so the
  // run reads the whole batch and clears it.
  const pendingTablesRef = useRef<Set<string | null>>(new Set());
  const { signal, gate } = useRefetchGate(() => {
    const scope = doorbellScope(pendingTablesRef.current);
    pendingTablesRef.current = new Set();
    const roster = rosterRefetchRef.current;
    if (scope === "roster" && roster) roster();
    else refetchRef.current();
  });
  useChannelsRealtime(workspaceId, (table) => {
    pendingTablesRef.current.add(table);
    signal();
  });

  // Presence is high-churn (~30s per listener) and never clobbers a send, so it bypasses
  // the coordinator — but refetches the ROSTER only, on a trailing debounce. The 90s
  // freshness window means coalescing a burst loses nothing.
  const presenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (presenceTimerRef.current) clearTimeout(presenceTimerRef.current);
    },
    []
  );
  usePresenceRealtime(workspaceId, () => {
    if (presenceTimerRef.current) return;
    presenceTimerRef.current = setTimeout(() => {
      presenceTimerRef.current = null;
      membersRefetchRef.current();
    }, PRESENCE_REFETCH_DEBOUNCE_MS);
  });

  // ⚠ Only `gate` leaves. `signal` is handed to the subscriptions HERE and nowhere else —
  // returning it too would invite a second registration for the same surface.
  return { gate };
}
