/**
 * /home's THREE WELLS AS A PURE FUNCTION — which well a row falls in.
 *
 * ⚠ **THE RENDERED HALF IS `channel-wells-render.test.tsx`**, through the real
 * page. What is here is the thing a rendered case cannot STATE: an AGE. The page
 * has no `now` to pass, deliberately, so the component holds no clock.
 */

import { describe, expect, it } from "vitest";
import { HOME_CHANNEL_WELLS, channelWellOf } from "./channel-wells";
import type { HomeRow } from "./home-rows";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
/** A channel row stamped `ms` before {@link NOW}, pinned or not. ⚠ The stamp is an
 *  ISO STRING on the wire, which is the shape `channelWellOf` has to survive; the
 *  pin is `HomeChannel.myFavoritedAt`, the SERVER's `channel_members.favorited_at`. */
function rowAgedMs(
  ms: number,
  over: { id?: string; myFavoritedAt?: string | null } = {}
): HomeRow {
  return {
    kind: "channel",
    id: over.id ?? "rel:ws-1",
    at: new Date(NOW - ms).toISOString(),
    channel: { myFavoritedAt: over.myFavoritedAt ?? null },
  } as unknown as HomeRow;
}

describe("channelWellOf — Samuel's 24h cut", () => {
  it("is Recent up to 24h and Earlier at it — the boundary, from ONE clock", () => {
    expect(channelWellOf(rowAgedMs(HOUR), NOW)).toBe("recent");
    // ⚠ ONE MILLISECOND INSIDE THE DAY is still the day…
    expect(channelWellOf(rowAgedMs(24 * HOUR - 1), NOW)).toBe("recent");
    // …and the boundary itself is NOT (`wellFor`'s `age < maxAgeMs`).
    expect(channelWellOf(rowAgedMs(24 * HOUR), NOW)).toBe("earlier");
    expect(channelWellOf(rowAgedMs(40 * 24 * HOUR), NOW)).toBe("earlier");
  });

  it("collapses the Agents tab's 7-day and 30-day spans into Earlier", () => {
    // 🔒 Samuel named THREE wells, not four: "one for Pinned, one for Recents …
    // and Earlier". A row three days old has no well of its own here.
    expect(channelWellOf(rowAgedMs(3 * 24 * HOUR), NOW)).toBe("earlier");
    expect(channelWellOf(rowAgedMs(12 * 24 * HOUR), NOW)).toBe("earlier");
  });

  it("files a FUTURE or UNPARSEABLE stamp as Recent, never into the closed well", () => {
    // ⚠ Clock skew is ordinary and a negative age is not evidence of anything.
    expect(channelWellOf(rowAgedMs(-5 * HOUR), NOW)).toBe("recent");
    const broken = { ...rowAgedMs(HOUR), at: "not a date" } as HomeRow;
    // ⚠ UNKNOWN IS NOT EMPTY (§11): `Earlier` is the one well closed by default,
    // so a row we could not date must not land in it.
    expect(channelWellOf(broken, NOW)).toBe("recent");
  });

  it("puts a FAVOURITED row in Pinned and in nothing else, however old or new", () => {
    // 🔒 PINNED MEANS FAVOURITED (Samuel, 2026-09-15) — `channel_members.favorited_at`
    // off the wire, not a per-device set this page invented.
    const pin = "2026-09-14T10:00:00.000Z";
    expect(channelWellOf(rowAgedMs(HOUR, { myFavoritedAt: pin }), NOW)).toBe("pinned");
    expect(
      channelWellOf(rowAgedMs(90 * 24 * HOUR, { myFavoritedAt: pin }), NOW)
    ).toBe("pinned");
    // …and a row that is not pinned is unaffected by one that is.
    expect(channelWellOf(rowAgedMs(HOUR, { id: "rel:ws-2" }), NOW)).toBe("recent");
  });

  /**
   * 🔒 **THE STALE-CACHE CASE (INVARIANTS §8).** `GET /api/home/channels` is
   * IndexedDB-persisted with a 24h `gcTime`, so the FIRST PAINT after this bundle
   * ships serves entries written by the previous one — which have NO `myFavoritedAt`.
   * The row must file under its own recency, which is the answer that was true for
   * every row before the field existed; `undefined !== null` would put the whole
   * list in **Pinned**.
   */
  it("files a row written before `myFavoritedAt` existed by its recency", () => {
    const stale = { ...rowAgedMs(HOUR) } as HomeRow & { channel: object };
    stale.channel = {};
    expect(channelWellOf(stale, NOW)).toBe("recent");
  });

  it("files a PENDING LINK row by its `at`, exactly like a channel", () => {
    const link = (ms: number): HomeRow =>
      ({
        kind: "link",
        id: "link:l-1",
        at: new Date(NOW - ms).toISOString(),
        link: {},
      }) as unknown as HomeRow;
    expect(channelWellOf(link(HOUR), NOW)).toBe("recent");
    expect(channelWellOf(link(9 * 24 * HOUR), NOW)).toBe("earlier");
  });

  it("is three wells in Samuel's order, with Earlier the only one closed", () => {
    expect(HOME_CHANNEL_WELLS.map((w) => w.label)).toEqual([
      "Pinned",
      "Recent",
      "Earlier",
    ]);
    expect(HOME_CHANNEL_WELLS.map((w) => w.defaultOpen)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
