import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPathKey } from "@/shared/api/query-keys";
import { channelKeys } from "@/features/channels/client/query-keys";
import type { Channel } from "@/features/channels/types";
import type { HomeChannelsPayload } from "@/features/home/types";
import { HOME_CHANNELS_PATH } from "./home-rows";

/**
 * MIRROR THE CHANNELS CACHE'S FACTS INTO /home's OWN LIST — so the **Pinned** well
 * moves on the click, and a renamed channel re-titles its row, not on the next
 * page load.
 *
 * ⚠ **IT WAS `use-home-favorite-sync.ts` UNTIL 2026-09-17 AND THE PIN IS NO LONGER
 * THE ONLY FACT IT CARRIES.** The Info tab's Name and Description became
 * click-to-edit that day (Samuel: *"I want to be able to click where the name and
 * description are"*), and `channels/hooks/use-channel-header-writes.ts` patches the
 * same `GET /api/channels` entry the pin does — so the row's TITLE and the solo
 * row's description line had the identical two-cache gap the pin had. **One
 * subscription copies all three**; a second one beside it would be the same
 * traversal on the same event with a different list of keys.
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
 * any one `/api/channels` entry knows about one of them. ⚠ **AND IT COPIES ONE
 * COLUMN PER FIELD**: `HomeChannel.name` / `.topic` and `Channel.name` / `.topic`
 * are the same two columns under the same two names, which is what makes this a
 * copy rather than a derivation. ⚠ And it reaches only
 * cache entries that EXIST — `setQueriesData` builds nothing, so a /home list that
 * has never loaded cannot grow a half-populated row.
 * ⚠ **AND IT RETURNS `prev` WHEN NOTHING CHANGED**, so the column does not
 * re-render on each of the channels cache's own updates — several a minute from
 * the transcript alone.
 */
export function useHomeChannelSync(): void {
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
      const facts = new Map(body.channels.map((c) => [c.id, c]));
      client.setQueriesData<HomeChannelsPayload>(
        { queryKey: apiPathKey(HOME_CHANNELS_PATH) },
        (prev) => {
          if (!prev?.channels?.length) return prev;
          let moved = false;
          const channels = prev.channels.map((row) => {
            const next = facts.get(row.channelId);
            if (!next) return row;
            const favoritedAt = next.myFavoritedAt ?? null;
            // 🔒 ⚠ **A FIELD THE ENTRY DOES NOT CARRY IS NOT AN EMPTY FIELD** —
            // this is the "copies, never invents" rule at the KEY level. An
            // optimistic patch names the one field it wrote
            // (`optimistic-cache.ts › patchChannel` merges a `{ name }` or a
            // `{ topic }`), and a partial entry must leave the row's other
            // columns exactly where they were rather than blanking a title.
            // ⚠ A NAME IS NEVER EMPTY (the server refuses one), so `""` here is
            // an absent value too; a TOPIC legitimately is, so only its TYPE is
            // the test.
            const name =
              typeof next.name === "string" && next.name !== ""
                ? next.name
                : row.name;
            const topic =
              typeof next.topic === "string" ? next.topic : (row.topic ?? "");
            // ⚠ `?? null` / `?? ""` ON THE CACHED SIDE TOO (INVARIANTS §8): a
            // payload written before `favoritedAt` or `topic` existed has no such
            // key, and `undefined` must compare equal to "not pinned" / "no
            // description" or every such row rewrites on every event.
            if (
              (row.favoritedAt ?? null) === favoritedAt &&
              row.name === name &&
              (row.topic ?? "") === topic
            ) {
              return row;
            }
            moved = true;
            return { ...row, favoritedAt, name, topic };
          });
          return moved ? { ...prev, channels } : prev;
        }
      );
    });
  }, [client]);
}
