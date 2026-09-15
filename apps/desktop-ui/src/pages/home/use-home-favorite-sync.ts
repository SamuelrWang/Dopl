import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPathKey } from "@/shared/api/query-keys";
import { channelKeys } from "@/features/channels/client/query-keys";
import type { Channel } from "@/features/channels/types";
import type { HomeChannelsPayload } from "@/features/home/types";
import { HOME_CHANNELS_PATH } from "./home-rows";

/**
 * MIRROR THE PIN FROM THE CHANNELS CACHE INTO /home's OWN LIST — so the **Pinned**
 * well moves on the click, not on the next page load.
 *
 * 🔒 **SAMUEL, 2026-09-15:** *"replace the bookmark icon next to the channel name
 * with the pin icon. Also, i noticed that the bookmark icon like alway breaks and
 * is super buggy."* **The pin IS the bookmark** —
 * `channel_members.favorited_at`, one server-backed fact — and the concrete bug
 * behind "super buggy" is that **it lives in TWO client caches and the write only
 * ever told one of them**: the header's toggle patches and invalidates
 * `GET /api/channels` (`channels/hooks/use-channel-preference-writes.ts ›
 * favorite`), while this page's list is `GET /api/home/channels`, which nothing
 * touched. Pinning filled the icon and left the row exactly where it was.
 *
 * ⚠ **THE BRIDGE IS HERE AND NOT IN THE WRITE, AND THAT IS `docs/INVARIANTS.md`
 * §1.** `channels → home` is a forbidden import, and that write is the WORKSPACE
 * channels page's too — a home-shaped cache key inside it would be a second host's
 * concern in a shared hook. **`use-home-unread-refresh.ts` drew this exact line
 * first** (a cache subscription rather than a callback threaded through
 * `StandaloneChannelSurface`); this is the same shape with one difference, below.
 *
 * ⚠ **IT PATCHES RATHER THAN INVALIDATES, AND THE DIFFERENCE IS THE POINT.** The
 * unread bridge reacts to a read that has ALREADY changed the server's answer, so
 * a refetch is the whole job. A pin has to move the row while the request is still
 * in flight — the channels cache is patched optimistically, so copying the value
 * across paints /home at the same instant the icon fills. The write's own
 * `invalidate` still re-reads `/api/channels` on settle and this fires again with
 * the server's answer, so an optimistic guess cannot survive a failure: a rollback
 * is an `updated` event like any other.
 *
 * ⚠ **KEYED ON THE PATH SEGMENT, off the same minter the reader registers with**
 * (`channelKeys.list().path`). A hand-typed key here is a silent no-op — nothing
 * fails, the well just never moves (the failure mode `shared/api/query-keys.ts`
 * opens with).
 * ⚠ **IT ONLY EVER COPIES, NEVER INVENTS.** A channel absent from the channels
 * cache leaves its home row untouched: /home holds rows from MANY link containers
 * and any one `/api/channels` entry knows about one of them.
 * ⚠ **AND IT WRITES NOTHING WHEN NOTHING CHANGED** — `setQueriesData` with a new
 * object on every event would re-render the whole column on each of the channels
 * cache's own updates, which the transcript alone produces several of a minute.
 */
export function useHomeFavoriteSync(): void {
  const client = useQueryClient();
  useEffect(() => {
    const watched = channelKeys.list().path;
    return client.getQueryCache().subscribe((event) => {
      // ⚠ `updated` + a SUCCESS action, not every notification: a cache entry
      // emits on mount, on observer changes and on failure too.
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (event.query.queryKey[0] !== watched) return;
      const body = event.query.state.data as { channels?: Channel[] } | undefined;
      if (!body?.channels?.length) return;
      const pins = new Map(
        body.channels.map((c) => [c.id, c.myFavoritedAt ?? null])
      );
      client.setQueriesData<HomeChannelsPayload>(
        { queryKey: apiPathKey(HOME_CHANNELS_PATH) },
        (prev) => {
          if (!prev?.channels?.length) return prev;
          let moved = false;
          const channels = prev.channels.map((row) => {
            if (!pins.has(row.channelId)) return row;
            const next = pins.get(row.channelId) ?? null;
            // ⚠ `?? null` ON THE CACHED SIDE TOO (INVARIANTS §8): a payload
            // written before `favoritedAt` existed has no key, and `undefined`
            // must compare equal to "not pinned" or every such row rewrites on
            // every event.
            if ((row.favoritedAt ?? null) === next) return row;
            moved = true;
            return { ...row, favoritedAt: next };
          });
          return moved ? { ...prev, channels } : prev;
        }
      );
    });
  }, [client]);
}
