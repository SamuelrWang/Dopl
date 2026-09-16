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
 * is super buggy."* **The pin IS the bookmark** — `channel_members.favorited_at`,
 * one server-backed fact — and the concrete bug behind "super buggy" is that **it
 * lives in TWO client caches and the write only ever told one of them**: the
 * header's toggle patches and invalidates `GET /api/channels`
 * (`channels/hooks/use-channel-preference-writes.ts › favorite`), while this
 * page's list is `GET /api/home/channels`, which nothing touched.
 *
 * ⚠ **THE BRIDGE IS HERE AND NOT IN THE WRITE, AND THAT IS `docs/INVARIANTS.md`
 * §1** — `channels → home` is a forbidden import, and that write is the WORKSPACE
 * channels page's too. `use-home-unread-refresh.ts` drew this line first.
 *
 * ⚠ **IT PATCHES RATHER THAN INVALIDATES, AND THE DIFFERENCE IS THE POINT.** A pin
 * has to move the row while the request is still in flight, so copying the
 * optimistically-patched value across paints /home at the instant the icon fills.
 * A ROLLBACK is an `updated` event like any other, so a failed write moves the row
 * back; the write's own `invalidate` then re-reads `/api/channels` and this fires
 * once more with the server's answer.
 *
 * ⚠ **KEYED ON THE PATH SEGMENT, off the same minter the reader registers with**
 * (`channelKeys.list().path`). A hand-typed key here is a silent no-op — nothing
 * fails, the well just never moves.
 * ⚠ **IT ONLY EVER COPIES, NEVER INVENTS.** A channel absent from the channels
 * cache leaves its home row untouched: /home holds rows from MANY containers and
 * any one `/api/channels` entry knows about one of them. ⚠ And it reaches only
 * cache entries that EXIST — `setQueriesData` builds nothing, so a /home list that
 * has never loaded cannot grow a half-populated row.
 * ⚠ **AND IT RETURNS `prev` WHEN NOTHING CHANGED**, so the column does not
 * re-render on each of the channels cache's own updates — several a minute from
 * the transcript alone.
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
