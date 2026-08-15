/**
 * The await HOLD (`awaitNewMessages`). Repositories mocked; `service-reads` (the
 * existence probe + access recheck) runs for real, so these also pin which REPO
 * calls a tick makes. Three invariants:
 *  1. ⚠ SECURITY — no message is DELIVERED to a caller who lost access. The
 *     recheck does not run every tick, so the hold must revalidate on the RETURN
 *     path, unconditionally, before it reads rows.
 *  2. CONTRACT — same cursor semantics, rows, instant return, 404 on revocation.
 *  3. EGRESS — a quiet tick issues ONE minimal existence query and no row read;
 *     recheck runs on the first held tick then every 10th.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import { awaitNewMessages, type AwaitHoldCounters } from "./service-await";
import { ChannelNotFoundError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const CHAN = "chan-1";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

function messageRow(seq: number): ChannelMessageRow {
  return {
    id: `msg-${seq}`,
    seq,
    channel_id: CHAN,
    workspace_id: WS,
    author_user_id: "user-2",
    author_kind: "agent",
    kind: "message",
    body: "the reply",
    metadata: {},
    client_msg_id: null,
    created_at: "2026-07-31T00:00:00Z",
  };
}

/** Same shape as `messageRow`, but the author is the caller themselves. */
function ownRow(seq: number): ChannelMessageRow {
  return { ...messageRow(seq), author_user_id: USER };
}

function membership(): ChannelMemberRow {
  return {
    channel_id: CHAN,
    user_id: USER,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

/**
 * Hold ending after EXACTLY `ticks` held ticks. Bounded by the abort signal, not
 * the wall clock, so counts are deterministic and the suite never sleeps.
 */
function holdFor(
  ticks: number,
  probe?: (tick: number) => boolean,
  opts: { since?: number; counters?: AwaitHoldCounters } = {}
) {
  const signal = { aborted: false };
  let tick = 0;
  vi.mocked(repoMessages.hasMessagesAfter).mockImplementation(async () => {
    tick += 1;
    const hit = probe ? probe(tick) : false;
    if (tick >= ticks) signal.aborted = true;
    return hit;
  });
  return awaitNewMessages(ctx, CHAN, {
    since: opts.since ?? 10,
    deadline: Date.now() + 60_000,
    signal,
    pollIntervalMs: 0,
    counters: opts.counters,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelAccess).mockResolvedValue({
    id: CHAN,
    visibility: "private",
  });
  vi.mocked(repo.hasMembership).mockResolvedValue(true);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.listMessages).mockResolvedValue([]);
  vi.mocked(repoMessages.hasMessagesAfter).mockResolvedValue(false);
});

describe("awaitNewMessages — security: access is proven before delivery", () => {
  it("revalidates BEFORE reading rows when the existence probe hits", async () => {
    const order: string[] = [];
    vi.mocked(repo.findChannelAccess).mockImplementation(async () => {
      order.push("revalidate");
      return { id: CHAN, visibility: "private" };
    });
    let reads = 0;
    vi.mocked(repoMessages.listMessages).mockImplementation(async () => {
      order.push("read");
      reads += 1;
      return reads === 1 ? [] : [messageRow(11)];
    });

    // Hit on tick 2, NOT a scheduled recheck tick, so only the return-path
    // recheck can prove access before delivery.
    const result = await holdFor(30, (tick) => {
      order.push("probe");
      return tick >= 2;
    });

    expect(result.messages).toHaveLength(1);
    expect(order).toEqual([
      "read", // tick 0: direct row read, misses
      "revalidate", // tick 1: the scheduled recheck
      "probe", // tick 1: existence, misses
      "probe", // tick 2: existence, HITS
      "revalidate", // and access is proven again before any row is read
      "read", // only now are full rows fetched
    ]);
  });

  it("cuts off a member whose access was revoked mid-hold, on the tick a message lands", async () => {
    // Quiet until tick 3, so the loss lands BETWEEN scheduled rechecks.
    let seen = 0;
    // Tick 1's scheduled recheck passes; membership is revoked after it.
    vi.mocked(repo.hasMembership).mockImplementation(async () => seen < 2);

    await expect(
      holdFor(30, (tick) => {
        seen = tick;
        return tick >= 3;
      })
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
    // ⚠ Rows for the arrived message were NEVER read, let alone returned.
    expect(repoMessages.listMessages).toHaveBeenCalledTimes(1); // tick 0 only
  });

  it("cuts off a caller whose channel was soft-deleted mid-hold", async () => {
    let seen = 0;
    vi.mocked(repo.findChannelAccess).mockImplementation(async () =>
      seen < 2 ? { id: CHAN, visibility: "private" } : null
    );

    await expect(
      holdFor(30, (tick) => {
        seen = tick;
        return tick >= 3;
      })
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
    expect(repoMessages.listMessages).toHaveBeenCalledTimes(1);
  });

  it("still ends the hold on the scheduled recheck while nothing is arriving", async () => {
    // No message lands, so only the periodic recheck can notice the revocation.
    vi.mocked(repo.hasMembership).mockResolvedValue(false);
    await expect(holdFor(30)).rejects.toBeInstanceOf(ChannelNotFoundError);
  });

  it("does not recheck a channel that is public (no membership query at all)", async () => {
    vi.mocked(repo.findChannelAccess).mockResolvedValue({
      id: CHAN,
      visibility: "public",
    });
    await holdFor(12);
    expect(repo.findChannelAccess).toHaveBeenCalled();
    expect(repo.hasMembership).not.toHaveBeenCalled();
  });
});

describe("awaitNewMessages — caller contract is unchanged", () => {
  it("returns immediately with the rows already past the cursor (tick 0, no probe)", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(11),
      messageRow(12),
    ]);

    const result = await holdFor(30);

    expect(result.messages.map((m) => m.seq)).toEqual([11, 12]);
    // Tick 0 is a direct row read — the desktop's `timeoutMs=1` wake path must
    // not pay an extra round trip, and the resolve just proved access.
    expect(repoMessages.hasMessagesAfter).not.toHaveBeenCalled();
    expect(repo.findChannelAccess).not.toHaveBeenCalled();
    expect(result.revalidations).toBe(0);
    expect(result.polls).toBe(1);
  });

  it("passes the SAME cursor and limit to the row read as before the diet", async () => {
    await holdFor(3, undefined, { since: 42 });
    expect(repoMessages.listMessages).toHaveBeenCalledWith(CHAN, {
      since: 42,
      limit: 200,
    });
    // Third arg is the (unset) author filter.
    expect(repoMessages.hasMessagesAfter).toHaveBeenCalledWith(CHAN, 42, undefined);
  });

  it("returns empty (a timeout) when nothing arrives", async () => {
    const result = await holdFor(5);
    expect(result.messages).toEqual([]);
    expect(result.polls).toBe(6); // tick 0 read + 5 existence probes
  });

  it("keeps holding when an existence hit reads back empty (never `[] + not timed out`)", async () => {
    // ⚠ A probe hit whose rows vanish must not return the uninterpretable
    // shape: no messages AND timedOut false.
    vi.mocked(repoMessages.listMessages).mockResolvedValue([]);

    const result = await holdFor(5, () => true);

    expect(result.messages).toEqual([]);
    expect(vi.mocked(repoMessages.hasMessagesAfter).mock.calls).toHaveLength(5);
  });

  it("stops on an aborted request signal", async () => {
    const signal = { aborted: true };
    const result = await awaitNewMessages(ctx, CHAN, {
      since: 10,
      deadline: Date.now() + 10_000,
      signal,
      pollIntervalMs: 0,
    });
    expect(result.messages).toEqual([]);
    expect(result.polls).toBe(1); // tick 0 only, then the abort ends it
  });

  it("hydrates author profiles onto returned messages exactly as the read path does", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([messageRow(11)]);
    vi.mocked(repo.fetchProfiles).mockResolvedValue([
      { id: "user-2", email: "p@x.com", display_name: "Peer", avatar_url: null },
    ]);
    const result = await holdFor(3);
    expect(result.messages[0].authorName).toBe("Peer");
  });
});

describe("awaitNewMessages — egress shape (Q8)", () => {
  it("a quiet tick issues ONE existence probe and NO row read", async () => {
    const result = await holdFor(6);
    expect(vi.mocked(repoMessages.hasMessagesAfter).mock.calls).toHaveLength(6);
    expect(repoMessages.listMessages).toHaveBeenCalledTimes(1);
    expect(result.polls).toBe(7);
  });

  it("rechecks access on the first held tick, then every 10th — not every tick", async () => {
    const result = await holdFor(25);
    // 25 held ticks → rechecks at 1, 11, 21 = 3.
    expect(result.revalidations).toBe(3);
    expect(repo.findChannelAccess).toHaveBeenCalledTimes(3);
    expect(repo.hasMembership).toHaveBeenCalledTimes(3);
    expect(result.polls).toBe(26);
  });

  it("holds the recheck cadence across a LONG hold (the 240s assembled case)", async () => {
    const result = await holdFor(160);
    // 160 ticks → rechecks at 1, 11, … 151 = 16.
    expect(result.revalidations).toBe(16);
  });

  it("does not double-recheck when a message lands on a scheduled recheck tick", async () => {
    // Tick 1 is both a scheduled recheck AND the hit — the return path must
    // reuse that proof, not issue a second identical pair.
    vi.mocked(repoMessages.listMessages)
      .mockResolvedValueOnce([])
      .mockResolvedValue([messageRow(11)]);

    const result = await holdFor(30, () => true);

    expect(result.messages).toHaveLength(1);
    expect(result.revalidations).toBe(1);
    expect(repo.findChannelAccess).toHaveBeenCalledTimes(1);
  });

  it("uses the NARROW access projections, never the full-row lookups", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(membership());
    await holdFor(6);
    // ⚠ Per-tick recheck must never pull a whole channel / member row.
    expect(repo.findChannelById).not.toHaveBeenCalled();
    expect(repo.findMembership).not.toHaveBeenCalled();
    expect(repo.findChannelAccess).toHaveBeenCalledWith(WS, CHAN);
    expect(repo.hasMembership).toHaveBeenCalledWith(CHAN, USER);
  });
});

describe("awaitNewMessages — author exclusion (opt-in)", () => {
  /**
   * A caller posting while its own await is armed must not wake on its own echo.
   * ⚠ Both repo mocks run over one fake table that honours the filter — a filter
   * threaded to the row read but NOT to the existence probe shows up here as a
   * hold that spins instead of one that keeps waiting.
   */
  function holdOver(
    rows: ChannelMessageRow[],
    opts: {
      since?: number;
      excludeAuthor?: string;
      ticks?: number;
      onProbe?: (tick: number) => void;
    } = {}
  ) {
    const signal = { aborted: false };
    let probes = 0;
    const visible = (excludeAuthor?: string, since?: number) =>
      rows.filter(
        (r) =>
          (since === undefined || r.seq > since) &&
          (excludeAuthor === undefined || r.author_user_id !== excludeAuthor)
      );
    vi.mocked(repoMessages.listMessages).mockImplementation(async (_c, o) =>
      visible(o.excludeAuthor, o.since)
    );
    vi.mocked(repoMessages.hasMessagesAfter).mockImplementation(
      async (_c, since, excludeAuthor) => {
        probes += 1;
        opts.onProbe?.(probes);
        if (probes >= (opts.ticks ?? 4)) signal.aborted = true;
        return visible(excludeAuthor, since).length > 0;
      }
    );
    return awaitNewMessages(ctx, CHAN, {
      since: opts.since ?? 10,
      deadline: Date.now() + 60_000,
      excludeAuthor: opts.excludeAuthor,
      signal,
      pollIntervalMs: 0,
    });
  }

  it("does NOT end the hold on a message the caller authored itself", async () => {
    const result = await holdOver([ownRow(11)], { excludeAuthor: USER });
    expect(result.messages).toEqual([]);
  });

  it("still ends the hold on a foreign message", async () => {
    const result = await holdOver([messageRow(11)], { excludeAuthor: USER });
    expect(result.messages.map((m) => m.seq)).toEqual([11]);
  });

  it("returns ONLY the foreign messages out of a mixed page", async () => {
    const result = await holdOver(
      [ownRow(11), messageRow(12), ownRow(13), messageRow(14)],
      { excludeAuthor: USER }
    );
    expect(result.messages.map((m) => m.seq)).toEqual([12, 14]);
  });

  it("an existence probe that sees only OWN messages never triggers a row fetch", async () => {
    // ⚠ Unfiltered, the probe hits every tick and the hold fetches, reads back
    // empty and continues — a two-query spin per tick for the rest of the hold.
    const rows: ChannelMessageRow[] = [];
    const result = await holdOver(rows, {
      excludeAuthor: USER,
      ticks: 6,
      onProbe: (tick) => {
        if (tick === 2) rows.push(ownRow(11));
      },
    });
    expect(result.messages).toEqual([]);
    expect(repoMessages.listMessages).toHaveBeenCalledTimes(1);
    expect(result.polls).toBe(7); // 1 read + 6 probes, no fetch-and-discard
  });

  it("threads the filter to BOTH the probe and the row read", async () => {
    await holdOver([], { excludeAuthor: USER, since: 42, ticks: 2 });
    expect(repoMessages.listMessages).toHaveBeenCalledWith(CHAN, {
      since: 42,
      limit: 200,
      excludeAuthor: USER,
    });
    expect(repoMessages.hasMessagesAfter).toHaveBeenCalledWith(CHAN, 42, USER);
  });

  it("without the option, an own-authored message ends the hold exactly as before", async () => {
    // Desktop listener NEEDS its own account's messages for thread targeting
    // and requester-window routing.
    const result = await holdOver([ownRow(11), messageRow(12)]);
    expect(result.messages.map((m) => m.seq)).toEqual([11, 12]);
    expect(repoMessages.listMessages).toHaveBeenCalledWith(CHAN, {
      since: 10,
      limit: 200,
      excludeAuthor: undefined,
    });
  });
});

describe("awaitNewMessages — telemetry survives a bad ending (L6)", () => {
  it("leaves its counts in the caller's object when the hold THROWS", () => {
    // ⚠ A hold ended by mid-hold revocation/soft-delete throws
    // ChannelNotFoundError and never reaches a return value, so counts living
    // only there lose exactly the holds worth measuring.
    const counters: AwaitHoldCounters = { polls: 0, revalidations: 0 };
    let seen = 0;
    vi.mocked(repo.hasMembership).mockImplementation(async () => seen < 2);

    return expect(
      holdFor(
        30,
        (tick) => {
          seen = tick;
          return tick >= 3;
        },
        { counters }
      )
    )
      .rejects.toBeInstanceOf(ChannelNotFoundError)
      .then(() => {
        // tick 0 row read + probes on ticks 1..3 + the recheck that threw.
        expect(counters.polls).toBe(4);
        expect(counters.revalidations).toBe(1);
      });
  });

  it("reports the same numbers through the object and the return value", () => {
    const counters: AwaitHoldCounters = { polls: 0, revalidations: 0 };
    return holdFor(25, undefined, { counters }).then((result) => {
      expect(counters.polls).toBe(result.polls);
      expect(counters.revalidations).toBe(result.revalidations);
    });
  });
});
