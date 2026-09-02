/**
 * ⚠ OWN POSTS MUST NOT POP YOUR OWN HOLD — and "own" means THIS SESSION, not
 * this account (F-405, 2026-09-02).
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
 * ⚠ AND THE FIRST FIX WAS HALF OF ONE. It kept the account exclusion as a
 * FALLBACK "when this session cannot name itself" — which is EVERY EXTERNAL MCP
 * CLIENT, the exact population that reported the outage. The repro still
 * reproduced. There is no fallback now.
 *
 * The rule: NEVER send `excludeAuthor`. Drop own-session rows from the page in
 * hand when this session can name itself, advancing the cursor past them so the
 * hold does not re-fetch them; drop nothing when it cannot.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import { AWAIT_HOLD_DEFAULT_MS } from "./channel-await-budget";
import { opAwait } from "./channel-ops-await";

/**
 * ⚠ THE CASES BELOW ASK FOR THE HOLD EXPLICITLY where they assert more than one
 * inner poll. An unstamped caller's DEFAULT is one poll long since T03, and a
 * "for every poll" assertion over a single call proves much less than it reads
 * as.
 */
const HOLD = AWAIT_HOLD_DEFAULT_MS;

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

describe("a SIBLING session on the same account is visible (F-405)", () => {
  it("sends NO excludeAuthor once this session can name itself", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      7,
      HOLD,
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
      HOLD,
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
      HOLD,
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

// ── The UNSTAMPED caller — every external MCP client ─────────────────
//
// ⚠ THIS IS THE POPULATION THAT REPORTED THE OUTAGE, and the first fix missed
// it. Scoping the filter to the session left `excludeAuthor = <account>` as the
// FALLBACK "when this session cannot name itself" — and no external client ever
// can: Claude Code sends no `X-Dopl-Session-Id`. So the exact repro (await on
// `since=853` returning nothing twice while seq 856, an agent post on the same
// account, sat in the table) still reproduced against the fix that was supposed
// to close it.
//
// ⚠ The cost is bounded and lands on the caller alone: an unstamped client may
// wake on a post it made itself. It is BLOCKED inside this call and cannot post
// during it, so only an older desktop build can trip that — and a noisy wake is
// recoverable where a silent hold is not.

describe("an unstamped caller sees its own account's agents", () => {
  it("sends NO author filter, on every poll", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, HOLD, ME);

    expect(awaitChannelMessages.mock.calls.length).toBeGreaterThan(1);
    for (const [, opts] of awaitChannelMessages.mock.calls) {
      // ⚠ This used to be `expect(opts.excludeAuthor).toBe(ME)` — the assertion
      // that pinned the outage in place for the whole external population.
      expect(opts).not.toHaveProperty("excludeAuthor");
      expect(opts.since).toBe(7);
    }
  });

  it("REGRESSION (the reported repro): seq 856, an agent post on the caller's own account", async () => {
    // ⚠ The stub enforces `excludeAuthor` THE WAY THE SERVER DOES
    // (`repository-messages.ts › hasMessagesAfter`), so sending it empties the
    // page and the hold reports a timeout — which is the outage, verbatim.
    const clock = fakeClock();
    const awaitChannelMessages = vi.fn<AwaitSpy>(async (_ref, opts) => {
      clock.advance(opts.timeoutMs ?? 0);
      const all = [row(856, undefined, ME)];
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
    );

    expect(res.isError).toBeFalsy();
    const text = JSON.stringify(res);
    expect(text).toContain("856");
    expect(text).toContain("1 new message");
  });

  it("drops nothing client-side either — there is no session id to key on", async () => {
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [row(900, MY_SESSION, ME), row(901, undefined, "user-peer")],
      timedOut: false,
    }));

    const res = await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      899,
      undefined,
      ME,
    );

    // ⚠ Even a row carrying SOMEONE's session stamp survives: without a stamp of
    // our own we cannot claim any of them is ours, and guessing is what hid the
    // counterparty in the first place.
    expect(JSON.stringify(res)).toContain("2 new messages");
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
});
