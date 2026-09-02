/**
 * ⚠ OWN POSTS MUST NOT POP YOUR OWN HOLD — and "own" means THIS SESSION, not
 * this account (F-341, 2026-09-02).
 *
 * An agent's own close-echo returning the hold instantly kills the wake the
 * primitive exists for, so the suppression is real and stays. What it must not
 * do is hide a SIBLING SESSION: one operator runs many concurrent agents, every
 * post is authored by the ACCOUNT (`service-writes.ts:448`), and an orchestrator
 * and its worker are therefore the same `author_user_id`. Excluding on that id
 * filtered the counterparty out of BOTH the page and the existence probe, so the
 * hold did not spin — it held silently to its deadline while the reply sat in
 * the table, and `op="read"` (which sets no such filter) showed it plainly.
 *
 * THIS FILE USED TO ASSERT THE BUG. It pinned `excludeAuthor === ME` on every
 * poll, which is exactly the behaviour that made a same-account counterparty
 * permanently invisible — a test can hold a defect in place as firmly as it
 * holds an invariant, and this one did for as long as it existed.
 *
 * The rule now: send `excludeAuthor` ONLY when this session cannot name itself.
 * When it can, send no author filter at all and drop own-session rows from the
 * page, advancing the cursor past them so the hold does not re-fetch them.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opAwait } from "./channel-ops-await";

const ME = "user-me";
const MY_SESSION = "chan-1:aaaa1111";
const SIBLING_SESSION = "chan-1:bbbb2222";

type AwaitOpts = {
  since: number;
  timeoutMs?: number;
  excludeAuthor?: string;
};

type AwaitSpy = (
  channelId: string,
  opts: AwaitOpts,
) => Promise<{ messages: Array<Record<string, unknown>>; timedOut: boolean }>;

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [
      { id: "chan-1", slug: "general", name: "General", visibility: "private" },
    ]),
    ...overrides,
  } as unknown as DoplClient;
}

/** Virtual clock — the whole multi-poll hold runs in microseconds. */
function fakeClock() {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A hold where nothing ever arrives, so every inner poll is observable. */
function quietHold() {
  const clock = fakeClock();
  return vi.fn<AwaitSpy>(async (_ref, opts) => {
    clock.advance(opts.timeoutMs ?? 0);
    return { messages: [], timedOut: true };
  });
}

/** One row as the route hands it over. `session` absent = no stamp on the wire. */
function row(seq: number, session?: string, author = "user-peer") {
  return {
    id: `m-${seq}`,
    seq,
    channelId: "chan-1",
    authorUserId: author,
    authorKind: "agent",
    kind: "message",
    body: `body ${seq}`,
    metadata: session ? { session_id: session } : {},
    clientMsgId: null,
    createdAt: "2026-09-02T00:00:00Z",
    authorName: "Pat",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── The regression: a sibling session on ONE account ──────────────────

describe("a SIBLING session on the same account is visible (F-341)", () => {
  it("sends NO excludeAuthor once this session can name itself", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      7,
      undefined,
      ME,
      null,
      MY_SESSION,
    );

    expect(awaitChannelMessages.mock.calls.length).toBeGreaterThan(1);
    for (const [, opts] of awaitChannelMessages.mock.calls) {
      // The bug: this used to be ME on every poll, which is what hid the peer.
      expect(opts).not.toHaveProperty("excludeAuthor");
      expect(opts.since).toBe(7);
    }
  });

  it("RETURNS a post written by another session of the SAME account", async () => {
    // The exact shape of the outage: both agents are `ME`; only the session
    // differs. ⚠ THE STUB ENFORCES `excludeAuthor` THE WAY THE SERVER DOES
    // (`repository-messages.ts:61-63`) — without that this test passes on the
    // buggy code too, because a stub that ignores the filter cannot show what
    // the filter did. With it, sending `excludeAuthor: ME` empties the page and
    // the hold reports a timeout, which is precisely the outage.
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      const all = [row(856, SIBLING_SESSION, ME)];
      const visible = opts.excludeAuthor
        ? all.filter((m) => m.authorUserId !== opts.excludeAuthor)
        : all;
      return { messages: visible, timedOut: visible.length === 0 };
    });

    const res = await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      853,
      undefined,
      ME,
      null,
      MY_SESSION,
    );

    expect(res.isError).toBeFalsy();
    const text = JSON.stringify(res);
    expect(text).toContain("856");
    expect(text).toContain("1 new message");
  });

  it("still suppresses THIS session's own echo", async () => {
    const clock = fakeClock();
    let call = 0;
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      call += 1;
      // Poll 1 sees only our own milestone; nothing after that.
      return call === 1
        ? { messages: [row(900, MY_SESSION, ME)], timedOut: false }
        : { messages: [], timedOut: true };
    });

    const res = await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      899,
      undefined,
      ME,
      null,
      MY_SESSION,
    );

    // Our own echo did NOT end the hold.
    expect(awaitChannelMessages.mock.calls.length).toBeGreaterThan(1);
    expect(JSON.stringify(res)).toContain("the wait timed out");
  });

  it("ADVANCES the cursor past its own echo instead of re-fetching it forever", async () => {
    const clock = fakeClock();
    let call = 0;
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      call += 1;
      return call === 1
        ? { messages: [row(900, MY_SESSION, ME)], timedOut: false }
        : { messages: [], timedOut: true };
    });

    await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      899,
      undefined,
      ME,
      null,
      MY_SESSION,
    );

    // ⚠ Without the advance, every later poll re-reads seq 900, the probe hits
    // on it every tick, and the budget burns out in milliseconds — the spin that
    // then reports itself to the agent as a platform clamp.
    const laterCursors = awaitChannelMessages.mock.calls.slice(1).map(([, o]) => o.since);
    expect(laterCursors.length).toBeGreaterThan(0);
    for (const c of laterCursors) expect(c).toBe(900);
  });

  it("keeps a foreign row that shares a page with our own echo", async () => {
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [row(901, MY_SESSION, ME), row(902, SIBLING_SESSION, ME)],
      timedOut: false,
    }));

    const res = await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      900,
      undefined,
      ME,
      null,
      MY_SESSION,
    );

    const text = JSON.stringify(res);
    expect(text).toContain("902");
    expect(text).toContain("1 new message");
  });
});

// ── The fallback population, which must not change ───────────────────

describe("with no session stamp the account filter is still the best available", () => {
  it("passes excludeAuthor = selfUserId on EVERY inner poll", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, undefined, ME);

    expect(awaitChannelMessages.mock.calls.length).toBeGreaterThan(1);
    for (const [, opts] of awaitChannelMessages.mock.calls) {
      // ⚠ Re-issued with the same cursor AND the same filter — dropping the
      // filter on re-issue still wakes on an own echo.
      expect(opts.since).toBe(7);
      expect(opts.excludeAuthor).toBe(ME);
    }
  });

  it("passes it on the poll that RETURNS messages too", async () => {
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [row(8)],
      timedOut: false,
    }));

    const res = await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      7,
      undefined,
      ME,
    );

    expect(res.isError).toBeFalsy();
    expect(awaitChannelMessages.mock.calls[0][1].excludeAuthor).toBe(ME);
  });

  it("passes NOTHING when selfUserId is null (boot handshake could not name the caller)", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, undefined, null);

    for (const [, opts] of awaitChannelMessages.mock.calls) {
      expect(opts).not.toHaveProperty("excludeAuthor");
    }
  });

  it("passes NOTHING when selfUserId is omitted entirely", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7);

    for (const [, opts] of awaitChannelMessages.mock.calls) {
      expect(opts).not.toHaveProperty("excludeAuthor");
    }
  });

  it("drops nothing client-side, so an unstamped peer row still returns", async () => {
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [row(9)],
      timedOut: false,
    }));

    const res = await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      8,
      undefined,
      ME,
    );

    expect(JSON.stringify(res)).toContain("1 new message");
  });
});
