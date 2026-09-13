import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPathKey } from "@/shared/api/query-keys";
import { channelKeys } from "@/features/channels/client/query-keys";
import { HOME_CHANNELS_PATH } from "./home-rows";

/**
 * CLEAR THE OPEN CHANNEL'S UNREAD MARKS — refetch `GET /api/home/channels` once
 * the selected channel's TRANSCRIPT has come back (2026-09-13).
 *
 * 🔒 **IT IS HUNG ON THE TRANSCRIPT READ AND NOT ON THE CLICK, AND THAT IS THE
 * WHOLE MECHANISM.** The dot and the `@ N` badge are measured against
 * `channel_members.last_read_at`, and the thing that ADVANCES that watermark is
 * the message read itself — `channels/server/service-reads.ts ›
 * readMessagePage` awaits `updateLastRead` before it answers. So by the time the
 * transcript's response lands in this client's cache the watermark has already
 * moved, and a refetch now returns the cleared marks. Refetching on the CLICK
 * instead is a race the badge loses about half the time: the home read and the
 * transcript read leave together.
 *
 * ⚠ **A CACHE SUBSCRIPTION RATHER THAN A CALLBACK THREADED THROUGH THE
 * SURFACE.** `StandaloneChannelSurface` is SHARED with the workspace channels
 * page (INVARIANTS §7 — one surface, two hosts), and an `onTranscriptRead` prop
 * added for /home's badge would be a second host's concern inside a component
 * that has no unread marks of its own. The transcript's cache entry is a public
 * fact about that read; /home watches it.
 *
 * ⚠ **KEYED ON THE PATH SEGMENT, off the same minter the reader registers
 * with** (`channelKeys.messages(id).path`). A hand-typed key here would be a
 * silent no-op — nothing fails, the badge just never clears (the failure mode
 * `shared/api/query-keys.ts` opens with).
 *
 * ⚠ **NO TIMER, and this is the standing rule rather than a preference**: it
 * reacts to an event that has already happened. Do not "make it more reliable"
 * with an interval.
 */
export function useHomeUnreadRefresh(channelId: string | null): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!channelId) return;
    const watched = channelKeys.messages(channelId).path;
    return client.getQueryCache().subscribe((event) => {
      // ⚠ `updated` + a SUCCESS action, not every notification: a cache entry
      // emits on mount, on observer changes and on failure too, and refetching
      // the page's own list on each of those is a request loop with a view.
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (event.query.queryKey[0] !== watched) return;
      void client.invalidateQueries({ queryKey: apiPathKey(HOME_CHANNELS_PATH) });
    });
  }, [channelId, client]);
}
