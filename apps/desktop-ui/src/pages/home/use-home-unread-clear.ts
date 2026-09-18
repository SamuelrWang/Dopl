import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { channelKeys } from "@/features/channels/client/query-keys";

/**
 * CLEAR THE OPEN CHANNEL'S UNREAD MARKS — re-read the channel LIST once the
 * selected channel's TRANSCRIPT has come back (2026-09-13).
 *
 * 🔒 **IT IS NOT A BRIDGE ANY MORE, AND THE RENAME SAYS SO (Wave 3, R-26 (b)).**
 * It was `use-home-unread-refresh.ts`, one of two cache-to-cache bridges holding
 * `GET /api/home/channels` in step with the channels cache; that cache is deleted
 * and the other bridge went with it. What is left is ONE invalidation of ONE cache,
 * because the row list and the transcript are still two ENTRIES of it.
 *
 * 🔒 **AND IT IS STILL NEEDED — MEASURED, NOT ASSUMED.** Dropping it leaves the dot
 * and the `@ N` pill lit over a channel the operator is reading: every
 * `channelKeys.list().all` invalidation in the channels feature hangs off a WRITE,
 * and a transcript read is none of those.
 *
 * 🔒 **IT IS HUNG ON THE TRANSCRIPT READ AND NOT ON THE CLICK, AND THAT IS THE
 * WHOLE MECHANISM.** Both marks are measured against `channel_members.last_read_at`,
 * and what ADVANCES that watermark is the message read itself — `service-reads.ts ›
 * readMessagePage` awaits `updateLastRead` before it answers. So by the time the
 * transcript lands in this cache the watermark has moved and a re-read returns the
 * cleared marks. Invalidating on the CLICK is a race the badge loses about half the
 * time: the two reads leave together.
 *
 * ⚠ **`.all` REACHES BOTH SCOPES, AND THAT IS RIGHT RATHER THAN WASTEFUL** — the
 * same watermark moved for both.
 *
 * ⚠ **A CACHE SUBSCRIPTION RATHER THAN A CALLBACK THREADED THROUGH THE SURFACE.**
 * `StandaloneChannelSurface` is SHARED with the workspace channels page (§7), and an
 * `onTranscriptRead` prop would be a second host's concern inside a component with
 * no unread marks of its own.
 *
 * ⚠ **KEYED ON THE PATH SEGMENT, off the same minter the reader registers with** —
 * a hand-typed key is a silent no-op: nothing fails, the badge just never clears.
 * ⚠ **NO TIMER**, standing rule: it reacts to an event that has already happened.
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
