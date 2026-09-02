/**
 * The `await` op as a WAKE PRIMITIVE. Pinned here:
 *   - opAwait ASSEMBLES one long hold from repeated ~50s inner polls, all
 *     re-issued on the SAME cursor, returning the instant anything lands;
 *   - a transient inner failure MID-HOLD degrades to the timed-out RESULT, not
 *     an error, which would carry none of the teaching;
 *   - a hold far under its ask is reported CUT SHORT with "do NOT re-arm" — a
 *     clamped hold never stays pending long enough to background;
 *   - the untrusted-content caveat is a HEADER above the bodies, not a footnote;
 *   - re-arm teaching carries a THREAD-STATE stop rule, never a timeout counter;
 *   - create_thread hands back the opening message's seq.
 *
 * Numbers themselves (env clamp, every deadline the hold fits under) are pinned
 * in `channel-deadlines.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import {
  AWAIT_HOLD_CAP_MS,
  AWAIT_HOLD_DEFAULT_MS,
} from "./channel-await-budget";
import { DESKTOP_SESSION_RUNTIME } from "./identity";
import { opCreateThread } from "./channel-ops-threads";
import { CHANNEL_DESCRIPTION } from "./channel-description";
import { UNTRUSTED_BODY_HEADER } from "./channel-render";
// ⚠ WHERE THE AWAIT PROTOCOL LIVES SINCE T10/T12 (2026-09-02). `create_thread`
// closed with four paragraphs of it; the result is one fact line now, so the
// paragraphs are re-pinned HERE — moved, never dropped.
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { opAwait } from "./channel-ops-await";

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

/**
 * ⚠ THE ASSEMBLED MULTI-POLL HOLD IS THE **DESKTOP** DEFAULT SINCE T03. An
 * unstamped caller's default is one inner poll long, because its own MCP client
 * aborts around 60s — so a case whose subject is the ASSEMBLY (re-issue on the
 * same cursor, a failure on poll 4, the elapsed bound) has to say which caller
 * it is, or it is silently testing a one-poll hold.
 */
const desktopAwait = (
  client: DoplClient,
  ref: string,
  since: number,
  timeoutMs?: number,
) => opAwait(client, ref, since, timeoutMs, null, DESKTOP_SESSION_RUNTIME);

describe("opAwait — long hold (WAKE-V1)", () => {
  /**
   * Virtual clock — `Date.now()` moves only when a poll "holds", so a long hold
   * runs in microseconds and the elapsed bound is asserted exactly. Advances by
   * whatever timeout the op asked for, as the real route does.
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

    // ⚠ Explicit ask, not the default: the assertions below read the UNSTAMPED
    // result text, and an unstamped caller's default is one poll long (T03).
    const res = await opAwait(client, "general", 7, AWAIT_HOLD_DEFAULT_MS);

    expect(res.isError).toBeFalsy();
    expect(awaitChannelMessages).toHaveBeenCalledTimes(3);
    // ⚠ Every re-issue keeps the caller's cursor — no advance until something
    // lands, so a re-issue cannot skip or double-count.
    for (const [ref, opts] of awaitChannelMessages.mock.calls) {
      expect(ref).toBe("general");
      expect(opts.since).toBe(7);
    }
    expect(clock.elapsedFrom(start)).toBeLessThan(240_000);
    const text = res.content[0].text;
    expect(text).toContain("done, here it is");
    expect(text).toContain("since=42");
    // ⚠ THE BANNER STAYS ON THE AWAIT LANES (F-407) — see the position pin
    // below. T11 dropped it from `read` / `list` / `read_sessions`; the two
    // holds keep it because a body arrives here AFTER the description was read.
    expect(text).toContain(UNTRUSTED_BODY_HEADER);
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
    // Last poll asks only for what is left.
    expect(awaitChannelMessages.mock.calls.map(([, o]) => o.timeoutMs)).toEqual([
      50_000, 10_000,
    ]);

    awaitChannelMessages.mockClear();
    const capStart = clock.now;
    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, 600_000);
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
    // ⚠ 1, not 0 — the route's query schema rejects a non-positive timeout.
    expect(awaitChannelMessages.mock.calls[0][1].timeoutMs).toBe(1);
  });

  it("spin brake: an instantly-answering server is not hammered for the hold", async () => {
    // ⚠ Clock never moves here, so the elapsed bound alone would loop forever.
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
    // ⚠ Rethrowing gives the agent a bare transport error carrying none of the
    // re-arm teaching. Failure lands on poll 4 so elapsed is a real hold, not
    // the cut-short case below.
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      if (awaitChannelMessages.mock.calls.length === 4) {
        throw new Error("socket hang up");
      }
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });

    const res = await desktopAwait(stubClient({ awaitChannelMessages }), "general", 7);

    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    // ⚠ NAMES what happened — "the wait timed out" sends the agent back to
    // waiting on a broken watch.
    expect(text).toContain("an inner poll failed");
    expect(text).toContain("socket hang up");
    expect(text).not.toContain("timed out after");
    expect(text).toContain("about 150s");
    expect(text).toContain("since=7");
    expect(text).toContain("before you end your turn");
    // ⚠ There is an exit — a permanently broken watch is not an unbounded loop.
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

    const text = (await desktopAwait(stubClient({ awaitChannelMessages }), "general", 7))
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
    // Platform-clamp signature: the route answers instantly, so the spin brake
    // ends a long hold in ~0s. Re-arming that never wakes anyone.
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
    // ⚠ The ordinary re-arm instruction must NOT also be present — the two read
    // as contradictory advice in one result.
    expect(text).not.toContain("re-arm the wait NOW");
  });

  it("an EARLY inner failure is reported as a failure, not as a platform clamp", async () => {
    // ⚠ CUT SHORT is reserved for a short hold with NO error: routing a one-off
    // socket reset there reads "the platform is clamping you, do NOT re-arm",
    // exactly wrong for a live exchange.
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      if (awaitChannelMessages.mock.calls.length === 2) throw new Error("reset");
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });

    const text = (await desktopAwait(stubClient({ awaitChannelMessages }), "general", 7))
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
    const empty = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      return { messages: [], timedOut: true };
    });
    const timedOut = (await opAwait(stubClient({ awaitChannelMessages: empty }), "general", 7))
      .content[0].text;
    const arrived = vi.fn<AwaitSpy>(async () => {
      clock.advance(1_000);
      return { messages: [message(42)], timedOut: false };
    });
    const withMessages = (
      await opAwait(stubClient({ awaitChannelMessages: arrived }), "general", 7)
    ).content[0].text;

    for (const text of [timedOut, withMessages]) {
      // ⚠ THE EXIT IS THE ADDRESSEE'S SILENCE, AND NOW IT IS THE ONLY ONE. It
      // used to have a cheaper first half — "stop when the thread is closed or
      // failed" — and thread closing was removed (wiring plan Phase 4,
      // 2026-08-18), taking the state and `get_thread`'s report of it. ⚠ The
      // absence must be SAID, not merely dropped: an agent trained on the old
      // surface waits for a close forever if nothing tells it there is none.
      expect(text).toContain("STOP and report");
      expect(text).toContain("30+ minutes");
      expect(text).toContain("operator");
      expect(text).toContain("no finished STATE to wait for");
      expect(text).not.toContain("closed or failed");
      expect(text).not.toContain('op="get_thread"');
      expect(text).toContain("task_progress");
      // ⚠ A flat "stop after N timeouts" abandons a peer heads-down on a long
      // job — the exact case this feature exists for.
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

    // ⚠ Unconditional instruction stays "re-arm now" — the count only triggers
    // a look at the thread, and the look decides.
    expect(text).toContain("re-arm the wait NOW");
    expect(text).toMatch(/every ~3 empty holds[\s\S]{0,80}check/i);
    expect(text).toContain("Keep re-arming while something came from that member");
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

    // ⚠ THE POSITION IS THE ASSERTION, not the presence. T11 dropped this
    // banner from `read`, `list` and `read_sessions` — the rule is stated once
    // in CHANNEL_DESCRIPTION, read at connection — and BOTH `await` lanes keep
    // it, because a caveat read only AFTER an injected line has been read is
    // not a caveat. The asymmetry between the two ops is F-407, filed and
    // deliberately unresolved; do not "fix" it by deleting this.
    expect(text).toContain(UNTRUSTED_BODY_HEADER);
    expect(text.indexOf(UNTRUSTED_BODY_HEADER)).toBeLessThan(
      text.indexOf("done, here it is"),
    );
    expect(CHANNEL_DESCRIPTION).toContain("SECURITY, SAID ONCE HERE");
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

    // ⚠ THE CURSOR IS NOW A TOKEN, AND IT IS THE SAME CURSOR. `await=since:41`
    // is what `since=41` was — pre-computed off the seq this write produced, so
    // the next call needs no read to find it.
    expect(text).toContain("await=since:41");
    expect(text).toContain("seq=41");
    expect(text).toContain("thread=thread-1");
    // ⚠ Teaching a follow-up read costs a round-trip AND races the peer: a
    // reply landing first becomes "the newest message", so the await starts
    // past the request and never returns the reply it was armed for.
    expect(text).not.toContain("limit=1");
    // ⚠ THE FOUR PARAGRAPHS LEFT AND MAY NOT GROW BACK — but they must also
    // still exist in the product, so each is pinned on the doctrine that now
    // carries it. Deleting either half of this pair is the regression.
    expect(text).not.toContain('op="await"');
    expect(text).not.toContain("STOP and report");
    expect(CHANNEL_DOCTRINE).toContain('call "await" with since=<the last seq you saw>');
    expect(CHANNEL_DOCTRINE).toContain("STOP and report to your operator");
    expect(CHANNEL_DOCTRINE).toContain("30+ minutes");
  });

  it("reports NO cursor rather than a fabricated one when the route gives no seq", async () => {
    // ⚠ Null seq (older deployment, or the idempotent short-circuit) → say so,
    // never invent a cursor. `since=0` REPLAYS THE CHANNEL and `since=null`
    // is a 400, so a fabricated value is worse than an absent one; the lookup
    // that finds the real seq is standing doctrine and is pinned below.
    const text = (
      await opCreateThread(
        threadClient(null),
        "general",
        "Ship it",
        "please do X",
        "pat@example.com",
      )
    ).content[0].text;

    // ⚠ BOTH ABSENCES ARE RENDERED, and as `-` rather than as a missing key: a
    // dash says the server looked and there was nothing.
    expect(text).toContain("seq=-");
    expect(text).toContain("await=-");
    expect(text).not.toContain("since:");
    expect(text).not.toContain("since=null");
    expect(text).not.toContain("since=undefined");
    // ⚠ MOVED, NOT DELETED: how to find the seq yourself is in the doctrine.
    expect(CHANNEL_DOCTRINE).toContain('"read" (or "list") to learn the latest seq');
  });
});
