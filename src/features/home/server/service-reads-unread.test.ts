/**
 * `service-reads.ts` — THE UNREAD MARKS on the home channels payload (Samuel,
 * live review 2026-09-13: the channel row wants "some notification system for
 * new @s"). Four things, and each of them is a way the badge could lie: which
 * channel a mention is counted against, where the "already read" line falls, what
 * the SCAN is allowed to ask the database for, and what a non-member gets.
 *
 * ⚠ **ITS OWN FILE, NOT MORE CASES IN `service-reads.test.ts`** — that suite
 * measured 404 lines against the 500-line cap (INVARIANTS §1) when this landed,
 * and this block is ~150. It re-declares the mock factory because `vi.mock` is
 * hoisted per file.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository", () => ({
  findMemberContainer: vi.fn(),
  listLinkContainers: vi.fn(),
  listLinksByCreator: vi.fn(),
  listLinksByWorkspaces: vi.fn(),
  listContainerPeers: vi.fn(),
  listContainerChannels: vi.fn(),
  listLastMessages: vi.fn(),
  listMyChannelReads: vi.fn(),
  listMyMentionStamps: vi.fn(),
  findLinkByToken: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listProfileSummaries: vi.fn(),
}));

import { getHomeChannels, HOME_MENTION_SCAN_LIMIT } from "./service-reads";
import * as repo from "./repository";
import { listProfileSummaries } from "@/features/workspaces/server/repository";

const ME = "11111111-1111-4111-8111-111111111111";
const WS_A = "33333333-3333-4333-8333-333333333333";
const WS_B = "77777777-7777-4777-8777-777777777777";
const CHAN_A = "44444444-4444-4444-8444-444444444444";
const CHAN_B = "88888888-8888-4888-8888-888888888888";

const mocked = vi.mocked(repo);

/** Two containers. ⚠ Their `created_at` differ, because the never-read floor is
 *  derived from that column and a single date would hide a mix-up. */
const A = {
  id: WS_A,
  slug: "alpha",
  public_id: "aaa111aaa111",
  created_at: "2026-09-01T00:00:00.000Z",
};
const B = {
  id: WS_B,
  slug: "beta",
  public_id: "bbb222bbb222",
  created_at: "2026-09-05T00:00:00.000Z",
};

/** Both channels READ up to the same instant — the baseline every case bends. */
const READ_AT = "2026-09-10T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.findMemberContainer.mockResolvedValue(null);
  mocked.listLinkContainers.mockResolvedValue([A, B]);
  mocked.listLinksByCreator.mockResolvedValue([]);
  mocked.listLinksByWorkspaces.mockResolvedValue(new Map());
  mocked.listContainerPeers.mockResolvedValue(new Map());
  mocked.listContainerChannels.mockResolvedValue(
    new Map([
      [WS_A, { id: CHAN_A, name: "Alpha", topic: "" }],
      [WS_B, { id: CHAN_B, name: "Beta", topic: "" }],
    ])
  );
  mocked.listLastMessages.mockResolvedValue(new Map());
  mocked.listMyChannelReads.mockResolvedValue(
    new Map([
      [CHAN_A, { channelId: CHAN_A, lastReadAt: READ_AT, favoritedAt: null }],
      [CHAN_B, { channelId: CHAN_B, lastReadAt: READ_AT, favoritedAt: null }],
    ])
  );
  mocked.listMyMentionStamps.mockResolvedValue([]);
  vi.mocked(listProfileSummaries).mockResolvedValue(new Map());
});

/** `channelId` → the row, so a case names the channel rather than an index. */
async function rows(): Promise<Record<string, { unread: boolean; unreadMentions: number }>> {
  const payload = await getHomeChannels(ME);
  return Object.fromEntries(
    payload.channels.map((c) => [
      c.channelId,
      { unread: c.unread, unreadMentions: c.unreadMentions },
    ])
  );
}

describe("unreadMentions — the `@ N` badge's aggregate", () => {
  it("counts TWO unread mentions on the channel they landed in, and none on its neighbour", async () => {
    mocked.listMyMentionStamps.mockResolvedValue([
      { channelId: CHAN_A, createdAt: "2026-09-11T09:00:00.000Z" },
      { channelId: CHAN_A, createdAt: "2026-09-12T09:00:00.000Z" },
    ]);

    expect(await rows()).toEqual({
      [CHAN_A]: { unread: false, unreadMentions: 2 },
      // ⚠ THE NEIGHBOUR IS THE POINT OF HAVING TWO CHANNELS: one aggregate per
      // channel, never one number smeared across the page.
      [CHAN_B]: { unread: false, unreadMentions: 0 },
    });
  });

  /**
   * ⚠ **A MENTION OF SOMEBODY ELSE NEVER REACHES THE TALLY, AND THE FILTER IS THE
   * QUERY — WHICH IS WHY THIS ASSERTS THE ARGUMENT.** The repository filters on
   * `metadata->mentionedUserIds @> [viewer]`, the SAME predicate the Tags inbox
   * uses (`channels/server/repository-mentions.ts › mentionContainmentFilter`,
   * imported and never retyped). A mock cannot express "a row the database would
   * not have returned", so what is pinnable here is that the caller is asked for
   * — the viewer, and nobody else.
   */
  it("asks the database for the VIEWER's mentions only", async () => {
    await getHomeChannels(ME);
    const [channelIds, userId] = mocked.listMyMentionStamps.mock.calls[0];
    expect(userId).toBe(ME);
    expect([...channelIds].sort()).toEqual([CHAN_A, CHAN_B].sort());
  });

  it("drops a mention OLDER than that channel's watermark — read is read", async () => {
    mocked.listMyMentionStamps.mockResolvedValue([
      { channelId: CHAN_A, createdAt: "2026-09-11T09:00:00.000Z" },
      // Before `READ_AT`: already seen. ⚠ The repository's global floor cannot
      // have excluded this one — it is newer than B's cutoff — so the per-channel
      // test in `unread-tally.ts` is what has to catch it.
      { channelId: CHAN_A, createdAt: "2026-09-09T09:00:00.000Z" },
      // ⚠ EXACTLY AT the watermark counts as READ, not as new.
      { channelId: CHAN_A, createdAt: READ_AT },
    ]);

    expect((await rows())[CHAN_A].unreadMentions).toBe(1);
  });

  it("goes to ZERO once everything is read", async () => {
    mocked.listMyChannelReads.mockResolvedValue(
      new Map([
        [CHAN_A, { channelId: CHAN_A, lastReadAt: "2026-09-13T00:00:00.000Z", favoritedAt: null }],
        [CHAN_B, { channelId: CHAN_B, lastReadAt: "2026-09-13T00:00:00.000Z", favoritedAt: null }],
      ])
    );
    mocked.listMyMentionStamps.mockResolvedValue([
      { channelId: CHAN_A, createdAt: "2026-09-11T09:00:00.000Z" },
      { channelId: CHAN_A, createdAt: "2026-09-12T09:00:00.000Z" },
    ]);

    expect(await rows()).toEqual({
      [CHAN_A]: { unread: false, unreadMentions: 0 },
      [CHAN_B]: { unread: false, unreadMentions: 0 },
    });
  });

  it("counts EVERY mention in a channel the caller has never opened", async () => {
    mocked.listMyChannelReads.mockResolvedValue(
      new Map([[CHAN_A, { channelId: CHAN_A, lastReadAt: null, favoritedAt: null }]])
    );
    mocked.listMyMentionStamps.mockResolvedValue([
      { channelId: CHAN_A, createdAt: "2026-09-02T09:00:00.000Z" },
      { channelId: CHAN_A, createdAt: "2026-09-03T09:00:00.000Z" },
    ]);

    expect((await rows())[CHAN_A].unreadMentions).toBe(2);
  });

  /**
   * 🔒 **THE SCAN'S FLOOR IS THE OLDEST CUTOFF ON THE PAGE, AND A MAXIMUM HERE
   * WOULD BE A SILENT WRONG ANSWER RATHER THAN A SLOW ONE** — the later-read
   * channel's cutoff would filter the earlier-read channel's unread mentions out
   * in SQL, where no tally could recover them.
   */
  it("floors the scan at the OLDEST cutoff, and at a never-read channel's container date", async () => {
    mocked.listMyChannelReads.mockResolvedValue(
      new Map([
        [CHAN_A, { channelId: CHAN_A, lastReadAt: READ_AT, favoritedAt: null }],
        // Never opened → its cutoff is container B's birth, which is older.
        [CHAN_B, { channelId: CHAN_B, lastReadAt: null, favoritedAt: null }],
      ])
    );

    await getHomeChannels(ME);

    const [, , since, limit] = mocked.listMyMentionStamps.mock.calls[0];
    expect(since).toBe(B.created_at);
    expect(limit).toBe(HOME_MENTION_SCAN_LIMIT);
  });
});

describe("unread — the plain dot", () => {
  it("is TRUE for a message newer than the watermark and FALSE once it is read", async () => {
    mocked.listLastMessages.mockResolvedValue(
      new Map([
        [CHAN_A, { at: "2026-09-11T09:00:00.000Z", body: "hi" }],
        [CHAN_B, { at: "2026-09-09T09:00:00.000Z", body: "hi" }],
      ])
    );

    expect(await rows()).toEqual({
      [CHAN_A]: { unread: true, unreadMentions: 0 },
      [CHAN_B]: { unread: false, unreadMentions: 0 },
    });
  });

  /**
   * ⚠ **INSTANTS, NOT STRINGS.** `lastMessageAt` comes back from Postgres with a
   * `+00:00` offset and microseconds; `last_read_at` is written by JS
   * `toISOString()` as `Z` with milliseconds. A lexicographic `>` reads the SAME
   * instant as unread forever — `"2026-09-10T12:00:00.000+00:00" >
   * "2026-09-10T12:00:00.000Z"` is false, and one microsecond later it is still
   * false, so a channel would go unread the moment its clock ticked past noon.
   */
  it("compares instants, so the two timestamp SPELLINGS of one moment agree", async () => {
    mocked.listLastMessages.mockResolvedValue(
      new Map([[CHAN_A, { at: "2026-09-10T12:00:00.000000+00:00", body: "hi" }]])
    );
    expect((await rows())[CHAN_A].unread).toBe(false);

    mocked.listLastMessages.mockResolvedValue(
      new Map([[CHAN_A, { at: "2026-09-10T12:00:01.000000+00:00", body: "hi" }]])
    );
    expect((await rows())[CHAN_A].unread).toBe(true);
  });

  it("is FALSE, with no badge, for a channel the caller is not a CHANNEL member of", async () => {
    // The container fence already proved workspace membership; this is the
    // `channel_members` row, and without it there is no watermark that opening
    // the channel could advance — so a mark here could never be cleared.
    mocked.listMyChannelReads.mockResolvedValue(new Map());
    mocked.listLastMessages.mockResolvedValue(
      new Map([[CHAN_A, { at: "2026-09-12T09:00:00.000Z", body: "hi" }]])
    );
    mocked.listMyMentionStamps.mockResolvedValue([
      { channelId: CHAN_A, createdAt: "2026-09-12T09:00:00.000Z" },
    ]);

    expect((await rows())[CHAN_A]).toEqual({ unread: false, unreadMentions: 0 });
    // And the scan is not even asked about it — no cutoff, no channel id.
    expect(mocked.listMyMentionStamps.mock.calls[0][0]).toEqual([]);
  });
});

describe("the two reads stay in the EXISTING two tiers (§9)", () => {
  it("asks for the watermarks by CONTAINER id, beside peers and channels", async () => {
    await getHomeChannels(ME);
    // ⚠ Container ids, not channel ids — that is what lets this run in the first
    // tier instead of adding a third round trip to the page's one read.
    expect(mocked.listMyChannelReads).toHaveBeenCalledWith([WS_A, WS_B], ME);
  });
});
