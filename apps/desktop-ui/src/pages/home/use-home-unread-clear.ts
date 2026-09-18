import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { channelKeys } from "@/features/channels/client/query-keys";

/**
 * CLEAR THE OPEN CHANNEL'S UNREAD MARKS — re-read the channel LIST once the
 * selected channel's TRANSCRIPT has come back (2026-09-13).
 *
 * 🔒 **IT IS NOT A BRIDGE ANY MORE, AND THE RENAME SAYS SO (Wave 3, R-26 (b)).**
 * It was `use-home-unread-refresh.ts`, one of two hand-written cache-to-cache
 * bridges holding `GET /api/home/channels` in step with the channels cache; that
 * second cache is DELETED and the other bridge (`use-home-channel-sync.ts`) went
 * with it — **one cache needs no bridge** (G4). What is left is ONE ordinary
 * invalidation of ONE cache, because the row list and the transcript are still
 * two ENTRIES of it: `channelKeys.list()` and `channelKeys.messages(id)`.
 *
 * 🔒 **AND IT IS STILL NEEDED — MEASURED, NOT ASSUMED.** Dropping it leaves the
 * dot and the `@ N` pill lit over a channel the operator is reading, because
 * nothing else invalidates the list on a READ: every `channelKeys.list().all`
 * invalidation in the channels feature hangs off a WRITE (rename, pin, thread
 * fan-out, lifecycle), and a transcript read is none of those.
 *
 * 🔒 **IT IS HUNG ON THE TRANSCRIPT READ AND NOT ON THE CLICK, AND THAT IS THE
 * WHOLE MECHANISM.** The dot and the badge are measured against
 * `channel_members.last_read_at`, and the thing that ADVANCES that watermark is
 * the message read itself — `channels/server/service-reads.ts › readMessagePage`
 * awaits `updateLastRead` before it answers. So by the time the transcript's
 * response lands in this client's cache the watermark has already moved, and a
 * re-read now returns the cleared marks. Invalidating on the CLICK instead is a
 * race the badge loses about half the time: the list read and the transcript read
 * leave together.
 *
 * ⚠ **`.all` REACHES BOTH SCOPES, AND THAT IS RIGHT RATHER THAN WASTEFUL.**
 * `?scope=account` and `?scope=container` are two entries under one path key, and
 * the same watermark moved for both — a channel opened from /home is the same
 * channel whose dot the workspace list draws.
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
export function useHomeUnreadClear(channelId: string | null): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!channelId) return;
    const watched = channelKeys.messages(channelId).path;
    return client.getQueryCache().subscribe((event) => {
      // ⚠ `updated` + a SUCCESS action, not every notification: a cache entry
      // emits on mount, on observer changes and on failure too, and re-reading
      // the page's own list on each of those is a request loop with a view.
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (event.query.queryKey[0] !== watched) return;
      void client.invalidateQueries({ queryKey: channelKeys.list().all });
    });
  }, [channelId, client]);
}
