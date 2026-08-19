"use client";

/**
 * Channels v2 — THE LIVE WIRING, as one hook: realtime → coalesced refetch, behind the
 * refetch coordinator every writer on the surface also holds.
 *
 * ⚠ SPLIT OUT OF `channels-v2-core.tsx` ON 2026-08-18 (wiring plan Phase 10). That file was
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
import { PRESENCE_REFETCH_DEBOUNCE_MS } from "../../constants";
import { useChannelsRealtime, usePresenceRealtime } from "../../client/realtime";

export function useChannelsV2Live({
  workspaceId,
  refetchAll,
  refetchMembers,
}: {
  workspaceId: string;
  /** Everything a content change can invalidate — channels, messages, members, threads, mentions. */
  refetchAll: () => void;
  /** The ROSTER alone, for presence. */
  refetchMembers: () => void;
}): { gate: MutationGate } {
  // ⚠ The refs are written in an EFFECT, not during render — the same shape
  // `use-api-mutation.ts › useRefetchGate` uses for its own `runRef`. A ref assigned in the
  // render pass is a `react-hooks/refs` error and, worse, is read by a subscription
  // callback that may fire before the render commits.
  const refetchRef = useRef<() => void>(() => {});
  const membersRefetchRef = useRef<() => void>(() => {});
  useEffect(() => {
    refetchRef.current = refetchAll;
    membersRefetchRef.current = refetchMembers;
  });

  const { signal, gate } = useRefetchGate(() => refetchRef.current());
  useChannelsRealtime(workspaceId, signal);

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
