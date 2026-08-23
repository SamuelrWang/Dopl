/**
 * THE WORKSPACE-WIDE HOLD — `op="await"` with no `channel`.
 *
 * ⚠ **THE FENCE IS THE POINT OF THIS SUITE.** The per-channel hold is fenced by
 * a resolved channel id that `resolveReadableChannelId` already vetted; this one
 * has no channel to resolve, so its fence is the MEMBERSHIP SET, and that set is
 * literally the `WHERE channel_id IN (…)` of every query the hold issues. Two
 * properties therefore have to hold and are driven adversarially below:
 *
 *   1. **A PRIVATE CHANNEL THE CALLER IS NOT IN IS NEVER NAMED BY ANY QUERY.**
 *      Not filtered out afterwards — never asked for. That is a stronger claim
 *      than "no rows come back", and it is the one tested, because a filter
 *      applied after a fetch is a filter somebody can delete.
 *   2. **M2: NO ROW FETCH PRECEDES A PROOF OF ACCESS WITHIN THE SAME TICK**, and
 *      the fetch uses the FRESH set. Re-proving membership and then reading with
 *      the stale id list would satisfy the letter of M2 and none of its purpose.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-await-workspace", () => ({
  listMemberChannelRefs: vi.fn(),
  hasWorkspaceMessagesAfter: vi.fn(),
  listWorkspaceMessagesAfter: vi.fn(),
}));
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, profilesById: vi.fn(async () => new Map()) };
});

import * as repo from "./repository-await-workspace";
import { awaitWorkspaceMessages } from "./service-await-workspace";
import type { ChannelContext } from "./service-shared";

const WS = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const MINE = "11111111-1111-1111-1111-111111111111";
/** A PRIVATE channel the caller is not a member of. The adversary. */
const THEIRS = "99999999-9999-9999-9999-999999999999";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

function message(over: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    seq: 42,
    channel_id: MINE,
    workspace_id: WS,
    author_user_id: "44444444-4444-4444-4444-444444444444",
    author_kind: "agent",
    kind: "message",
    body: "hello",
    metadata: {},
    client_msg_id: null,
    created_at: "2026-08-22T10:00:00.000Z",
    ...over,
  };
}

const REF = { id: MINE, name: "General", slug: "general" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the membership fence", () => {
  it("ADVERSARIAL: a private channel the caller is not in is never even QUERIED", async () => {
    // The repository answers with the caller's memberships only — which is its
    // own contract. What this asserts is that the SERVICE passes exactly that
    // set down and invents nothing.
    vi.mocked(repo.listMemberChannelRefs).mockResolvedValue([REF]);
    vi.mocked(repo.listWorkspaceMessagesAfter).mockResolvedValue([
      message() as never,
    ]);

    await awaitWorkspaceMessages(ctx, { since: 1, deadline: Date.now() + 50 });

    for (const call of vi.mocked(repo.listWorkspaceMessagesAfter).mock.calls) {
      expect(call[0]).toEqual([MINE]);
      expect(call[0]).not.toContain(THEIRS);
    }
    for (const call of vi.mocked(repo.hasWorkspaceMessagesAfter).mock.calls) {
      expect(call[0]).not.toContain(THEIRS);
    }
  });

  it("ADVERSARIAL: a row that leaks in from an unwatched channel gets NO channel label", async () => {
    // ⚠ Defense in depth on the RENDER side: if a row from a channel the fence
    // never named somehow reaches hydration, it must not be dressed up with a
    // name the caller was never entitled to. `null` forces the reader to fall
    // back to the id.
    vi.mocked(repo.listMemberChannelRefs).mockResolvedValue([REF]);
    vi.mocked(repo.listWorkspaceMessagesAfter).mockResolvedValue([
      message({ channel_id: THEIRS }) as never,
    ]);

    const out = await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() + 50,
    });
    expect(out.messages[0].channelName).toBeNull();
    expect(out.messages[0].channelSlug).toBeNull();
  });

  it("a caller with NO memberships is told the count, not shown a silent empty page", async () => {
    vi.mocked(repo.listMemberChannelRefs).mockResolvedValue([]);
    vi.mocked(repo.listWorkspaceMessagesAfter).mockResolvedValue([]);
    const out = await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() - 1,
    });
    expect(out.channelCount).toBe(0);
    expect(out.messages).toEqual([]);
  });

  it("labels each message with the channel it came from", async () => {
    vi.mocked(repo.listMemberChannelRefs).mockResolvedValue([REF]);
    vi.mocked(repo.listWorkspaceMessagesAfter).mockResolvedValue([
      message() as never,
    ]);
    const out = await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() + 50,
    });
    expect(out.messages[0].channelName).toBe("General");
    expect(out.messages[0].channelSlug).toBe("general");
  });
});

describe("M2 — no row fetch precedes a proof of access within the tick", () => {
  it("TICK 0 proves access BEFORE the first row read", async () => {
    const order: string[] = [];
    vi.mocked(repo.listMemberChannelRefs).mockImplementation(async () => {
      order.push("prove");
      return [REF];
    });
    vi.mocked(repo.listWorkspaceMessagesAfter).mockImplementation(async () => {
      order.push("fetch");
      return [message() as never];
    });

    await awaitWorkspaceMessages(ctx, { since: 1, deadline: Date.now() + 50 });
    expect(order[0]).toBe("prove");
    expect(order.indexOf("prove")).toBeLessThan(order.indexOf("fetch"));
  });

  /**
   * ⚠ THE SHORT-CIRCUIT IS PART OF THE INVARIANT, NOT AN EXCEPTION TO IT. On the
   * FIRST held tick the periodic recheck already runs, so the hit path skips a
   * second identical query — a proof from earlier in the SAME tick necessarily
   * predates the fetch, and re-running it learns nothing. The next case covers
   * the tick where no periodic recheck fires, which is where the hit path has to
   * prove for itself.
   */
  it("on the FIRST held tick the periodic proof covers the fetch (no duplicate query)", async () => {
    const order: string[] = [];
    vi.mocked(repo.listMemberChannelRefs).mockImplementation(async () => {
      order.push("prove");
      return [REF];
    });
    let reads = 0;
    vi.mocked(repo.listWorkspaceMessagesAfter).mockImplementation(async () => {
      order.push("fetch");
      reads += 1;
      return reads === 1 ? [] : ([message()] as never);
    });
    vi.mocked(repo.hasWorkspaceMessagesAfter).mockImplementation(async () => {
      order.push("probe");
      return true;
    });

    await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() + 400,
      pollIntervalMs: 1,
    });

    // prove, fetch(empty), [tick 1] prove, probe, fetch(hit)
    expect(order).toEqual(["prove", "fetch", "prove", "probe", "fetch"]);
    const lastFetch = order.lastIndexOf("fetch");
    const firstFetch = order.indexOf("fetch");
    const proofBefore = order.lastIndexOf("prove", lastFetch);
    expect(
      proofBefore,
      "the delivering read must be preceded by a proof taken in the same tick"
    ).toBeGreaterThan(firstFetch);
  });

  it("on a LATER tick, where no periodic recheck fires, the HIT path proves for itself", async () => {
    const order: string[] = [];
    vi.mocked(repo.listMemberChannelRefs).mockImplementation(async () => {
      order.push("prove");
      return [REF];
    });
    let reads = 0;
    vi.mocked(repo.listWorkspaceMessagesAfter).mockImplementation(async () => {
      order.push("fetch");
      reads += 1;
      return reads === 1 ? [] : ([message()] as never);
    });
    // Miss on tick 1 (which DID get a periodic proof), hit on tick 2 (which did
    // not) — so the proof before the delivering fetch can only come from the hit
    // path itself.
    let probes = 0;
    vi.mocked(repo.hasWorkspaceMessagesAfter).mockImplementation(async () => {
      order.push("probe");
      probes += 1;
      return probes > 1;
    });

    await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() + 400,
      pollIntervalMs: 1,
    });

    // prove, fetch, [t1] prove, probe(miss), [t2] probe(hit), prove, fetch
    expect(order).toEqual([
      "prove",
      "fetch",
      "prove",
      "probe",
      "probe",
      "prove",
      "fetch",
    ]);
    const lastFetch = order.lastIndexOf("fetch");
    const proofBefore = order.lastIndexOf("prove", lastFetch);
    const probeBefore = order.lastIndexOf("probe", lastFetch);
    expect(
      proofBefore,
      "on a tick with no periodic recheck, the row read must still be preceded by a proof"
    ).toBeGreaterThan(probeBefore);
  });

  it("the fetch uses the FRESH channel set, not the one the probe ran on", async () => {
    // ⚠ THE WORKSPACE-SPECIFIC HALF OF M2. Re-proving is pointless if the read
    // still names the channels the caller has since left. Membership shrinks
    // between the first proof and the second; the winning fetch must use the
    // smaller set.
    const SECOND = { id: "55555555-5555-5555-5555-555555555555", name: "Ops", slug: "ops" };
    let proofs = 0;
    vi.mocked(repo.listMemberChannelRefs).mockImplementation(async () => {
      proofs += 1;
      return proofs === 1 ? [REF, SECOND] : [REF];
    });
    let reads = 0;
    vi.mocked(repo.listWorkspaceMessagesAfter).mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? [] : ([message()] as never);
    });
    vi.mocked(repo.hasWorkspaceMessagesAfter).mockResolvedValue(true);

    await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() + 400,
      pollIntervalMs: 1,
    });

    const calls = vi.mocked(repo.listWorkspaceMessagesAfter).mock.calls;
    expect(calls[0][0]).toEqual([MINE, SECOND.id]);
    expect(
      calls[calls.length - 1][0],
      "the delivering read still named a channel the caller had left"
    ).toEqual([MINE]);
  });

  it("the probe carries the SAME author filter as the read", async () => {
    // ⚠ A probe that hits on a row the read then drops spins the hold
    // fetch-empty-continue, one extra pair of queries per tick.
    vi.mocked(repo.listMemberChannelRefs).mockResolvedValue([REF]);
    vi.mocked(repo.listWorkspaceMessagesAfter).mockResolvedValue([]);
    vi.mocked(repo.hasWorkspaceMessagesAfter).mockResolvedValue(false);

    await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() + 30,
      pollIntervalMs: 1,
      excludeAuthor: ME,
    });

    for (const call of vi.mocked(repo.hasWorkspaceMessagesAfter).mock.calls) {
      expect(call[2]).toBe(ME);
    }
    for (const call of vi.mocked(repo.listWorkspaceMessagesAfter).mock.calls) {
      expect(call[2]).toBe(ME);
    }
  });

  it("an existence HIT that reads back empty keeps HOLDING — it never returns a false timeout", async () => {
    // ⚠ Returning `{messages: []}` on a hit-then-empty reads to the caller as
    // "delivered nothing", which is what a TIMEOUT means. Different facts.
    vi.mocked(repo.listMemberChannelRefs).mockResolvedValue([REF]);
    vi.mocked(repo.hasWorkspaceMessagesAfter).mockResolvedValue(true);
    vi.mocked(repo.listWorkspaceMessagesAfter).mockResolvedValue([]);

    const out = await awaitWorkspaceMessages(ctx, {
      since: 1,
      deadline: Date.now() + 30,
      pollIntervalMs: 1,
    });
    expect(out.messages).toEqual([]);
    // It kept polling rather than returning after the first hit.
    expect(vi.mocked(repo.listWorkspaceMessagesAfter).mock.calls.length).toBeGreaterThan(1);
  });
});

describe("counters survive a throw (the hold-diagnostic contract)", () => {
  it("the caller's counters object is mutated in place", async () => {
    const counters = { polls: 0, revalidations: 0 };
    vi.mocked(repo.listMemberChannelRefs).mockResolvedValue([REF]);
    vi.mocked(repo.listWorkspaceMessagesAfter).mockRejectedValue(
      new Error("connection failure")
    );
    await expect(
      awaitWorkspaceMessages(ctx, {
        since: 1,
        deadline: Date.now() + 30,
        counters,
      })
    ).rejects.toThrow();
    // ⚠ The proof ran and was counted even though the hold ended in a throw —
    // otherwise the metric covers only clean finishes, the wrong half of the
    // population during an egress incident.
    expect(counters.revalidations).toBe(1);
    expect(counters.polls).toBe(1);
  });
});
