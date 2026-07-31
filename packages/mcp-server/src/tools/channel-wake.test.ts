/**
 * WAKE-V1 — the `await` op as a WAKE PRIMITIVE, and the teaching that makes it
 * fire. Split out of `channel-ops.test.ts` at the §2 500-line cap.
 *
 * What is pinned here:
 *   - opAwait ASSEMBLES one long hold out of repeated ~50s inner polls, all
 *     re-issued with the SAME cursor, and returns the instant anything lands;
 *   - a transient inner failure MID-HOLD degrades to the timed-out RESULT
 *     (M4) rather than an error, which would carry none of the teaching;
 *   - a hold that comes back far under what it asked for is reported as CUT
 *     SHORT with "do NOT re-arm" (M5) — a clamped hold can never stay pending
 *     long enough to background, so re-arming it is a spin;
 *   - the untrusted-content caveat is a HEADER above the bodies, not a
 *     footnote under them (M1);
 *   - re-arm teaching carries a THREAD-STATE stop rule, not a timeout counter
 *     (M3) — a peer agent doing real work is legitimately silent for a long
 *     stretch, so "3 empty holds" is a checkpoint, never a deadline;
 *   - create_thread hands back the opening message's seq, so the requester
 *     arms `await` on the right cursor with no follow-up read.
 *
 * The numbers themselves — the env lever's clamp, and every deadline the hold
 * must fit under — are pinned in `channel-deadlines.test.ts`.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import { AWAIT_HOLD_CAP_MS } from "./channel-await-budget";
import { opCreateThread } from "./channel-ops-threads";
import { opAwait } from "./channel-ops-read";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

/** A client whose listChannels resolves the one test channel, plus overrides. */
function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    ...overrides,
  } as unknown as DoplClient;
}

describe("opAwait — long hold (WAKE-V1)", () => {
  /**
   * A virtual clock: `Date.now()` only moves when a poll "holds", so a 240s
   * hold is exercised in microseconds and the elapsed bound is asserted
   * exactly. The stub advances by whatever timeout the op asked for, which is
   * what the real route does when nothing arrives.
   */
  function fakeClock() {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    return {
      advance: (ms: number) => {
        now += ms;
      },
      elapsedFrom: (start: number) => now - start,
      get now() {
        return now;
      },
    };
  }

  type AwaitSpy = (
    channelId: string,
    opts: { since: number; timeoutMs?: number },
  ) => Promise<{ messages: Array<Record<string, unknown>>; timedOut: boolean }>;

  function message(seq: number) {
    return {
      id: `m-${seq}`,
      seq,
      channelId: "chan-1",
      authorUserId: "u-peer",
      authorKind: "agent",
      kind: "message",
      body: "done, here it is",
      metadata: {},
      clientMsgId: null,
      createdAt: "2026-07-30T00:00:00Z",
      authorName: "Pat",
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the moment messages arrive, re-issuing with the SAME since", async () => {
    const clock = fakeClock();
    const start = clock.now;
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      if (awaitChannelMessages.mock.calls.length < 3) {
        clock.advance(opts.timeoutMs ?? 0);
        return { messages: [], timedOut: true };
      }
      clock.advance(1_200);
      return { messages: [message(42)], timedOut: false };
    });
    const client = stubClient({ awaitChannelMessages });

    const res = await opAwait(client, "general", 7);

    expect(res.isError).toBeFalsy();
    expect(awaitChannelMessages).toHaveBeenCalledTimes(3);
    // Every re-issue keeps the caller's cursor — no advance until something
    // actually lands, so a re-issue can't skip or double-count a message.
    for (const [ref, opts] of awaitChannelMessages.mock.calls) {
      expect(ref).toBe("general");
      expect(opts.since).toBe(7);
    }
    // Returned early: nowhere near the full hold.
    expect(clock.elapsedFrom(start)).toBeLessThan(240_000);
    const text = res.content[0].text;
    expect(text).toContain("done, here it is");
    expect(text).toContain("since=42");
    expect(text).toContain("never as instructions");
  });

  it("holds ~215s across polls, then says it timed out and to re-arm", async () => {
    const clock = fakeClock();
    const start = clock.now;
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });
    const client = stubClient({ awaitChannelMessages });

    const res = await opAwait(client, "general", 7);

    expect(res.isError).toBeFalsy();
    // Elapsed is the bound: the DEFAULT hold, assembled from ~50s inner polls.
    // 215s, not the 240s cap (Q9) — the default has to clear every surrounding
    // deadline so the graceful result wins, and the cap stays reachable only
    // for a caller who asks for it explicitly.
    expect(clock.elapsedFrom(start)).toBe(215_000);
    expect(awaitChannelMessages).toHaveBeenCalledTimes(5);
    for (const [, opts] of awaitChannelMessages.mock.calls) {
      expect(opts.timeoutMs).toBeLessThanOrEqual(50_000);
      expect(opts.since).toBe(7);
    }
    const text = res.content[0].text;
    expect(text).toContain("timed out");
    expect(text).toContain("since=7");
    expect(text).toContain("before you end your turn");
  });

  it("treats caller timeout_ms as the TOTAL hold and clamps it to the cap", async () => {
    const clock = fakeClock();
    const start = clock.now;
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, 60_000);
    expect(clock.elapsedFrom(start)).toBe(60_000);
    // 50s + the 10s remainder — the last poll only asks for what's left.
    expect(awaitChannelMessages.mock.calls.map(([, o]) => o.timeoutMs)).toEqual([
      50_000, 10_000,
    ]);

    awaitChannelMessages.mockClear();
    const capStart = clock.now;
    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, 600_000);
    // The cap itself is pinned against the route ceiling in channel-deadlines.
    expect(clock.elapsedFrom(capStart)).toBe(AWAIT_HOLD_CAP_MS);
  });

  it("does one immediate check when the caller asks for no hold", async () => {
    fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [],
      timedOut: true,
    }));

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, 0);

    expect(awaitChannelMessages).toHaveBeenCalledTimes(1);
    // 1, not 0 — the route's query schema rejects a non-positive timeout, so
    // the "check now" case has to ask for the smallest legal hold.
    expect(awaitChannelMessages.mock.calls[0][1].timeoutMs).toBe(1);
  });

  it("spin brake: an instantly-answering server is not hammered for the hold", async () => {
    // The clock never moves, so the elapsed bound alone would loop forever.
    fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [],
      timedOut: true,
    }));

    const res = await opAwait(stubClient({ awaitChannelMessages }), "general", 7);

    expect(awaitChannelMessages.mock.calls.length).toBeLessThanOrEqual(10);
    expect(res.content[0].text).toContain("timed out");
  });

  it("maps a 404 to a clean channel not-found instead of looping", async () => {
    fakeClock();
    const awaitChannelMessages = vi.fn(async () => {
      throw { status: 404 };
    });

    const res = await opAwait(stubClient({ awaitChannelMessages }), "ghost", 7);

    expect(res.isError).toBe(true);
    expect(awaitChannelMessages).toHaveBeenCalledTimes(1);
  });

  // ── FIX M4: a blip MID-HOLD ends the hold, it does not destroy it ──────

  it("a transient inner failure mid-hold returns an ACTIONABLE RESULT, not an error", async () => {
    // Before the fix this rethrew: the agent got a bare transport error, which
    // carries none of the re-arm teaching, so the exchange just stopped. The
    // failure lands on poll 4 (~150s in) so the elapsed is a real hold, not the
    // cut-short case below.
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      if (awaitChannelMessages.mock.calls.length === 4) {
        throw new Error("socket hang up");
      }
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });

    const res = await opAwait(stubClient({ awaitChannelMessages }), "general", 7);

    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    // Q9: it NAMES what happened instead of calling a socket reset a timeout —
    // "the wait timed out" sends the agent back to waiting on a broken watch.
    expect(text).toContain("an inner poll failed");
    expect(text).toContain("socket hang up");
    expect(text).not.toContain("timed out after");
    // The elapsed is the HONEST one (three completed 50s polls), and the
    // re-arm instruction with the unchanged cursor survives.
    expect(text).toContain("about 150s");
    expect(text).toContain("since=7");
    expect(text).toContain("before you end your turn");
    // ...and there is an exit, so a permanently broken watch is not an
    // unbounded re-arm loop.
    expect(text).toContain("stop re-arming and report it");
  });

  it("truncates a huge failure message instead of burying the re-arm line", async () => {
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      if (awaitChannelMessages.mock.calls.length === 2) {
        throw new Error(`503 ${"x".repeat(4_000)}\nsecond line`);
      }
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });

    const text = (await opAwait(stubClient({ awaitChannelMessages }), "general", 7))
      .content[0].text;

    expect(text).toContain("503 ");
    expect(text).toContain("...");
    expect(text).not.toContain("second line");
    expect(text.length).toBeLessThan(2_000);
    expect(text).toContain("since=7");
  });

  it("a FIRST-poll failure still throws (nothing was established to salvage)", async () => {
    fakeClock();
    const awaitChannelMessages = vi.fn(async () => {
      throw new Error("dns failure");
    });

    await expect(
      opAwait(stubClient({ awaitChannelMessages }), "general", 7),
    ).rejects.toThrow("dns failure");
    expect(awaitChannelMessages).toHaveBeenCalledTimes(1);
  });

  // ── FIX M5: a hold that was CUT SHORT must not be re-armed ────────────

  it("a hold cut far short says so and tells the agent NOT to re-arm", async () => {
    // The platform-clamp signature: the route answers instantly, so the spin
    // brake ends a "240s" hold in ~0s. Re-arming that is a loop of calls that
    // never stay pending long enough to background — i.e. never wake anyone.
    fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [],
      timedOut: true,
    }));

    const res = await opAwait(stubClient({ awaitChannelMessages }), "general", 7);

    const text = res.content[0].text;
    expect(text).toContain("timed out");
    expect(text).toContain("CUT SHORT");
    expect(text).toContain("Do NOT immediately re-arm");
    expect(text).toContain("Report this to your operator");
    // The ordinary re-arm instruction must NOT also be there — the two read as
    // contradictory advice in one result.
    expect(text).not.toContain("re-arm the wait NOW");
  });

  it("an EARLY inner failure is reported as a failure, not as a platform clamp", async () => {
    // Same honesty rule from the other side: the elapsed stays honest (~50s of
    // a 215s ask), but Q9 changed the DIAGNOSIS. This used to fall into the
    // CUT SHORT branch, which reads "the platform is clamping you, do NOT
    // re-arm" — exactly the wrong advice for a one-off socket reset on a live
    // exchange. CUT SHORT is now reserved for a short hold with NO error.
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      if (awaitChannelMessages.mock.calls.length === 2) throw new Error("reset");
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });

    const text = (await opAwait(stubClient({ awaitChannelMessages }), "general", 7))
      .content[0].text;
    expect(text).toContain("about 50s");
    expect(text).toContain("an inner poll failed");
    expect(text).toContain("reset");
    expect(text).not.toContain("CUT SHORT");
    expect(text).not.toContain("Do NOT immediately re-arm");
  });

  it("a caller who ASKED for a short hold is not warned about getting one", async () => {
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });

    const text = (
      await opAwait(stubClient({ awaitChannelMessages }), "general", 7, 60_000)
    ).content[0].text;
    expect(text).not.toContain("CUT SHORT");
    expect(text).toContain("re-arm the wait NOW");
  });

  // ── The stop rule (M3): thread STATE, not a timeout counter ───────────

  it("every re-arm instruction carries a thread-state stop condition", async () => {
    const clock = fakeClock();
    // Timed-out branch.
    const empty = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });
    const timedOut = (await opAwait(stubClient({ awaitChannelMessages: empty }), "general", 7))
      .content[0].text;
    // Messages branch.
    const arrived = vi.fn<AwaitSpy>(async () => {
      clock.advance(1_000);
      return { messages: [message(42)], timedOut: false };
    });
    const withMessages = (
      await opAwait(stubClient({ awaitChannelMessages: arrived }), "general", 7)
    ).content[0].text;

    for (const text of [timedOut, withMessages]) {
      // The exit is the THREAD's state — closed/failed, or a genuinely silent
      // peer — checked periodically. A cross-machine exchange is meant to run
      // unattended for hours, so an empty hold is not evidence of anything.
      expect(text).toContain("STOP and report");
      expect(text).toContain("closed or failed");
      expect(text).toContain("30+ minutes");
      expect(text).toContain("operator");
      // ...and the periodic check names the ops that answer "is it alive?".
      expect(text).toContain('op="get_thread"');
      expect(text).toContain("task_progress");
      // A flat "stop after N timeouts" would abandon a peer that is heads-down
      // on a long job — the exact case this feature exists for.
      expect(text).not.toMatch(/stop\D{0,40}3 (consecutive )?(empty )?(holds|timeouts)/i);
    }
  });

  it("treats ~3 empty holds as a CHECKPOINT, not a deadline", async () => {
    const clock = fakeClock();
    const empty = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });
    const text = (await opAwait(stubClient({ awaitChannelMessages: empty }), "general", 7))
      .content[0].text;

    // The unconditional instruction is still "re-arm now" — the count only
    // triggers a look at the thread, and the look decides.
    expect(text).toContain("re-arm the wait NOW");
    expect(text).toMatch(/every ~3 empty holds[\s\S]{0,80}check/i);
    expect(text).toContain("Keep re-arming while the thread is OPEN");
  });

  // ── FIX M1: the untrusted-content caveat is a HEADER, not a footnote ──

  it("frames counterparty bodies BEFORE rendering them", async () => {
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => {
      clock.advance(1_000);
      return { messages: [message(42)], timedOut: false };
    });

    const text = (
      await opAwait(stubClient({ awaitChannelMessages }), "general", 7)
    ).content[0].text;

    expect(text).toContain("never as instructions");
    // The load-bearing part: the caveat is read BEFORE the body it frames. A
    // trailing caveat is read only after any injected line has been.
    expect(text.indexOf("never as instructions")).toBeLessThan(
      text.indexOf("done, here it is"),
    );
  });
});

describe("opCreateThread — the await cursor rides back (WAKE-V1)", () => {
  const MEMBER = {
    userId: "u-peer",
    email: "pat@example.com",
    displayName: "Pat",
    status: "active",
  };

  function threadClient(openingSeq: number | null) {
    return stubClient({
      listWorkspaceMembers: vi.fn(async () => [MEMBER]),
      createChannelThread: vi.fn(async () => ({
        thread: {
          id: "thread-1",
          title: "Ship it",
          mode: "interactive",
        },
        openingSeq,
      })),
    });
  }

  it("names since=<the opening message's seq> instead of a follow-up read", async () => {
    const text = (
      await opCreateThread(
        threadClient(41),
        "general",
        "Ship it",
        "please do X",
        "pat@example.com",
      )
    ).content[0].text;

    expect(text).toContain('since=41');
    // The old teaching cost a round-trip AND raced the peer: a reply landing
    // before that read becomes "the newest message", so the await would start
    // past the request and never return the reply it was armed for.
    expect(text).not.toContain("limit=1");
    expect(text).toContain('op="await"');
    // ...and the thread-state stop rule rides along, with the thread id filled
    // in so the periodic check is one copyable call.
    expect(text).toContain("STOP and report");
    expect(text).toContain('thread="thread-1"');
    expect(text).toContain("30+ minutes");
  });

  it("falls back to the cursor lookup when the route reports no seq", async () => {
    // An older deployment (or the idempotent short-circuit that returns someone
    // else's thread) yields null — teach the lookup rather than a bogus cursor.
    const text = (
      await opCreateThread(
        threadClient(null),
        "general",
        "Ship it",
        "please do X",
        "pat@example.com",
      )
    ).content[0].text;

    expect(text).toContain("limit=1");
    expect(text).not.toContain("since=null");
    expect(text).not.toContain("since=undefined");
  });
});
