/**
 * THE PING HOLD's tick shape and its one fence.
 *
 * ⚠ **THE SUITE NEVER SLEEPS IN REAL SECONDS AND NEVER READS THE WALL CLOCK FOR
 * A BOUND** — `service-await.test.ts`'s rule. Every hold below is ended by an
 * abort signal over an injected 0ms interval, so the tick counts are exact rather
 * than timing-dependent.
 *
 * The properties that fail quietly:
 *  - **THE FENCE IS `recipient_user_id = ctx.userId`, ON EVERY QUERY.** It runs
 *    on the RLS-bypassing admin client, so the argument IS the access control —
 *    and unlike the two message holds there is no wider set to narrow, which is
 *    why this loop has no re-proof cadence.
 *  - **AN EXISTENCE HIT THAT READS BACK EMPTY MUST KEEP HOLDING.** Returning
 *    there reports a timeout that did not happen, because the route derives
 *    `timedOut` from exactly that emptiness.
 *  - **THE PROBE'S FILTERS MIRROR THE READ'S.** A probe that hits on a row the
 *    read drops spins the hold; one that misses a row the read would return is
 *    the invisibility bug this whole surface exists to fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-pings");

import * as pingRepo from "./repository-pings";
import { awaitPings } from "./service-pings-await";
import type { ChannelContext } from "./service-shared";

const WS = "11111111-2222-3333-4444-555555555555";
const ME = "22222222-3333-4444-5555-666666666666";
const CH = "33333333-4444-5555-6666-777777777777";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

function row(seq: number) {
  return {
    id: `p-${seq}`,
    seq,
    workspace_id: WS,
    channel_id: CH,
    task_id: null,
    sender_user_id: "sender",
    sender_agent_id: null,
    recipient_kind: "desktop",
    recipient_user_id: ME,
    recipient_agent_id: null,
    kind: "done",
    body: "b",
    created_at: new Date().toISOString(),
    channel_slug: "build",
  };
}

/**
 * A hold that ends after exactly `ticks` HELD ticks, bounded by the signal rather
 * than the clock so the counts are deterministic. `deadline` is far away on
 * purpose: if the signal ever stopped working the test would hang rather than
 * pass, which is the failure mode worth having.
 */
function holdFor(ticks: number) {
  const signal = { aborted: false };
  let seen = 0;
  vi.mocked(pingRepo.hasPingForRecipient).mockImplementation(async () => {
    seen += 1;
    if (seen >= ticks) signal.aborted = true;
    return false;
  });
  return { signal, deadline: Date.now() + 60_000 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pingRepo.listPingsForRecipient).mockResolvedValue([] as never);
  vi.mocked(pingRepo.hasPingForRecipient).mockResolvedValue(false as never);
});

describe("the immediate first read", () => {
  it("returns a waiting ping without holding at all", async () => {
    vi.mocked(pingRepo.listPingsForRecipient).mockResolvedValue([
      row(7),
    ] as never);
    const out = await awaitPings(ctx, {
      since: 0,
      deadline: Date.now() + 60_000,
      pollIntervalMs: 0,
    });
    expect(out.pings.map((p) => p.seq)).toEqual([7]);
    // ⚠ The first read is a ROW read, not a probe — a near-zero-timeout arm
    // would otherwise pay a round trip to learn a boolean it then re-reads.
    expect(pingRepo.hasPingForRecipient).not.toHaveBeenCalled();
  });
});

describe("a quiet hold", () => {
  it("returns empty, which is what the route reports as timedOut", async () => {
    const { signal, deadline } = holdFor(3);
    const out = await awaitPings(ctx, {
      since: 0,
      deadline,
      signal,
      pollIntervalMs: 0,
    });
    expect(out.pings).toEqual([]);
    expect(vi.mocked(pingRepo.hasPingForRecipient).mock.calls.length).toBe(3);
  });

  it("probes once per held tick and reads NO rows while nothing exists", async () => {
    const { signal, deadline } = holdFor(4);
    await awaitPings(ctx, { since: 0, deadline, signal, pollIntervalMs: 0 });
    // One row read (the immediate first), then probes only.
    expect(vi.mocked(pingRepo.listPingsForRecipient).mock.calls.length).toBe(1);
  });
});

describe("an existence hit", () => {
  it("reads the page and returns it", async () => {
    vi.mocked(pingRepo.hasPingForRecipient).mockResolvedValue(true as never);
    vi.mocked(pingRepo.listPingsForRecipient)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([row(9)] as never);
    const out = await awaitPings(ctx, {
      since: 0,
      deadline: Date.now() + 60_000,
      pollIntervalMs: 0,
    });
    expect(out.pings.map((p) => p.seq)).toEqual([9]);
  });

  it("KEEPS HOLDING when the read comes back empty, never reporting a timeout", async () => {
    // ⚠ The regression this guards: an early `return { pings: [] }` here reads
    // to the caller as "delivered nothing", which is what a TIMEOUT means.
    const signal = { aborted: false };
    let probes = 0;
    vi.mocked(pingRepo.hasPingForRecipient).mockImplementation(async () => {
      probes += 1;
      if (probes >= 3) signal.aborted = true;
      return true;
    });
    const out = await awaitPings(ctx, {
      since: 0,
      deadline: Date.now() + 60_000,
      signal,
      pollIntervalMs: 0,
    });
    expect(out.pings).toEqual([]);
    expect(probes).toBe(3);
    // It re-read on every one of those ticks rather than giving up on the first.
    expect(
      vi.mocked(pingRepo.listPingsForRecipient).mock.calls.length
    ).toBeGreaterThan(3);
  });
});

describe("🔒 the fence is on every query the hold issues", () => {
  it("passes ctx.userId and the workspace to the read AND the probe", async () => {
    const { signal, deadline } = holdFor(2);
    await awaitPings(ctx, { since: 5, deadline, signal, pollIntervalMs: 0 });
    for (const call of vi.mocked(pingRepo.listPingsForRecipient).mock.calls) {
      expect(call[0]).toBe(ME);
      expect(call[1]).toBe(WS);
    }
    for (const call of vi.mocked(pingRepo.hasPingForRecipient).mock.calls) {
      expect(call[0]).toBe(ME);
      expect(call[1]).toBe(WS);
      // ⚠ The same cursor the read carries — the probe mirroring the read filter
      // for filter is the rule `repository-pings.ts` states.
      expect(call[2]).toBe(5);
    }
  });
});

describe("the counters the route logs", () => {
  it("counts every query, so a hold ended by a throw is still measurable", async () => {
    const { signal, deadline } = holdFor(2);
    const counters = { polls: 0 };
    await awaitPings(ctx, {
      since: 0,
      deadline,
      signal,
      counters,
      pollIntervalMs: 0,
    });
    // The immediate read plus one per held tick.
    expect(counters.polls).toBe(3);
  });
});
