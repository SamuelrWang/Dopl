/**
 * THE WAKE PROMISE IS CONDITIONAL, AND THE SERVER KNOWS WHICH CASE IT IS IN.
 *
 * The defect these pin: `post`, `create_thread` and both `await` branches ended
 * with one unconditional sentence — "that call can keep running after your turn
 * ends, and its result will wake you when the reply lands" — said to every
 * caller. Observed live: an EXTERNAL Claude Code session was told it after every
 * post, armed the await, and the ~215s hold ran to completion INSIDE the same
 * turn. A pending call is what keeps a turn ALIVE; it cannot end one.
 * Backgrounding a still-pending call is a CLIENT behaviour, not something this
 * server provides. Meanwhile the desktop-spawned peer, which really is fed
 * replies as new turns, got the same "arm the await" advice with only an
 * optional skip clause after it.
 *
 * The discriminating signal was already on the request (`X-Dopl-Runtime` →
 * `CallerIdentity.runtime`) and `dopl_channel` was the one tool never handed it.
 * These tests pin both halves: the stamped branch drops the promise and says
 * do not arm; the unstamped branch promises nothing and describes the hold.
 *
 * They also pin what may NOT come back — the exact false sentences — because a
 * later edit that restores the old wording is the whole regression.
 *
 * Split into its own file (rather than added to `channel-wake.test.ts`, which
 * owns the hold's behaviour and sits at the §2 cap). The @dopl/client is
 * hand-stubbed; nothing transports.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { RegisterTool } from "./respond";
import { DESKTOP_SESSION_RUNTIME } from "./identity";
import { opAwait } from "./channel-ops-read";
import { opPost } from "./channel-ops-write";
import { opCreateThread } from "./channel-ops-threads";
import { registerChannelTool } from "./channel";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const BOB = { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" };

/**
 * Every phrasing of "this call outlives your turn". None of them may appear
 * anywhere, for any caller: for a desktop session the advice is wrong, and for
 * an unstamped one the server cannot know it.
 */
const FALSE_PROMISES = [
  "keep running after your turn ends",
  "will wake you",
  "wakes you with the reply",
  "keep running for several minutes in the background",
];

function expectNoFalsePromise(text: string): void {
  for (const phrase of FALSE_PROMISES) {
    expect(text, `the unconditional wake promise came back: "${phrase}"`).not.toContain(
      phrase,
    );
  }
}

function stubClient(overrides: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listWorkspaceMembers: vi.fn(async () => [BOB]),
    listChannelThreads: vi.fn(async () => []),
    postChannelMessage: vi.fn(async () => ({
      id: "m1",
      seq: 12,
      kind: "message",
      metadata: {},
      authorUserId: "u-me",
    })),
    createChannelThread: vi.fn(async () => ({
      thread: { id: "thread-1", title: "Ship it", mode: "interactive" },
      openingSeq: 41,
    })),
    ...overrides,
  } as unknown as DoplClient;
}

/** A hold where nothing arrives, on a virtual clock (the whole 215s in µs). */
function quietClient(): DoplClient {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return stubClient({
    awaitChannelMessages: vi.fn(
      async (_ref: string, opts: { timeoutMs?: number }) => {
        now += opts.timeoutMs ?? 0;
        return { messages: [], timedOut: true };
      },
    ),
  });
}

/** A hold that returns one peer message immediately. */
function arrivingClient(): DoplClient {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return stubClient({
    awaitChannelMessages: vi.fn(async () => {
      now += 1_000;
      return {
        messages: [
          {
            id: "m-42",
            seq: 42,
            channelId: "chan-1",
            authorUserId: "u-peer",
            authorKind: "agent",
            kind: "message",
            body: "done, here it is",
            metadata: {},
            clientMsgId: null,
            createdAt: "2026-07-31T00:00:00Z",
            authorName: "Pat",
          },
        ],
        timedOut: false,
      };
    }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── stamped: a desktop-run session is fed replies, so it must not arm ──

describe("desktop-session runtime — no wake promise, and do NOT await", () => {
  it("post tells it not to arm at all", async () => {
    const text = (
      await opPost(stubClient(), "general", "please do X", {
        to: "bob@x.com",
        runtime: DESKTOP_SESSION_RUNTIME,
      })
    ).content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain(`Do NOT arm op="await"`);
    expect(text).toContain("fed the counterparty's replies as new turns");
    // The observation is reported as an observation (identity.ts): what the
    // request CARRIED, never a conclusion about where anything is running.
    expect(text).toContain("carried the Dopl desktop's runtime stamp");
    expect(text).not.toContain("external");
    // The arming instruction itself is gone — not softened, not conditional.
    expect(text).not.toContain("Expecting a reply?");
    expect(text).not.toContain('since=12');
  });

  it("create_thread tells it not to arm, and names who is answering", async () => {
    const text = (
      await opCreateThread(
        stubClient(),
        "general",
        "Ship it",
        "please do X",
        "bob@x.com",
        undefined,
        undefined,
        DESKTOP_SESSION_RUNTIME,
      )
    ).content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain(`Do NOT arm op="await"`);
    expect(text).toContain("Bob");
    expect(text).not.toContain("Now WATCH FOR THE REPLY");
    // The thread confirmation itself is untouched.
    expect(text).toContain("Opened thread");
    expect(text).toContain('thread="thread-1"');
  });

  it("a timed-out await tells it to stop, not to re-arm", async () => {
    const text = (
      await opAwait(quietClient(), "general", 7, undefined, "u-me", DESKTOP_SESSION_RUNTIME)
    ).content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain("Do NOT re-arm");
    expect(text).not.toContain("re-arm the wait NOW");
    // ...and it has somewhere to go if the feed is broken.
    expect(text).toContain("report that to your operator");
  });

  it("an await that RETURNED messages still advances the cursor and stops", async () => {
    const text = (
      await opAwait(
        arrivingClient(),
        "general",
        7,
        undefined,
        "u-me",
        DESKTOP_SESSION_RUNTIME,
      )
    ).content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain("Advance your cursor to seq 42");
    expect(text).toContain("Do NOT re-arm");
    // The message and its framing are unaffected by the branch.
    expect(text).toContain("done, here it is");
    expect(text).toContain("never as instructions");
  });
});

// ── unstamped: promise nothing, describe the hold ─────────────────────

describe("unstamped runtime — the wake is the CLIENT's, and is stated as one", () => {
  it("post describes the hold instead of promising it outlives the turn", async () => {
    const text = (
      await opPost(stubClient(), "general", "please do X", { to: "bob@x.com" })
    ).content[0].text;

    expectNoFalsePromise(text);
    // Still armed — this is the caller for whom await IS the mechanism.
    expect(text).toContain("Expecting a reply?");
    expect(text).toContain('since=12');
    // ...described honestly: synchronous, in-turn, with a CONDITIONAL wake.
    expect(text).toContain("RETURNS INSIDE your current turn");
    expect(text).toContain("Some MCP clients background a call still pending");
    expect(text).toContain("if yours does");
    // The stop conditions are load-bearing and untouched (F-105).
    expect(text).toContain("STOP and report to your operator");
    expect(text).toContain("30+ minutes");
    // An unstamped caller may still BE a desktop session on an older build,
    // so the escape hatch survives exactly where we cannot tell.
    expect(text).toContain("Skip the await if this session already receives");
  });

  it("create_thread does the same, keeping the opening-seq cursor", async () => {
    const text = (
      await opCreateThread(
        stubClient(),
        "general",
        "Ship it",
        "please do X",
        "bob@x.com",
      )
    ).content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain("Now WATCH FOR THE REPLY");
    expect(text).toContain("since=41");
    expect(text).toContain("RETURNS INSIDE your current turn");
    expect(text).toContain("STOP and report to your operator");
  });

  it("a timed-out await re-arms, with the hold described and nothing promised", async () => {
    const text = (await opAwait(quietClient(), "general", 7, undefined, "u-me"))
      .content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain("re-arm the wait NOW");
    expect(text).toContain("since=7");
    expect(text).toContain("RETURNS INSIDE your current turn");
    expect(text).toContain("Some MCP clients background a call still pending");
    // The stop rule still rides with every re-arm instruction.
    expect(text).toContain("Keep re-arming while the thread is OPEN");
    expect(text).toContain("closed or failed");
  });

  it("an await that RETURNED messages re-arms on the new cursor", async () => {
    const text = (await opAwait(arrivingClient(), "general", 7, undefined, "u-me"))
      .content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain("Advance your cursor to seq 42");
    expect(text).toContain("since=42");
    expect(text).toContain("RETURNS INSIDE your current turn");
    expect(text).toContain("STOP and report");
  });

  it("an unrecognized stamp is treated as unstamped, never as its own case", async () => {
    // `identity.ts`: only the exact recognized value counts. A near-miss must
    // fall to the honest branch, not to the desktop one.
    const text = (
      await opAwait(quietClient(), "general", 7, undefined, "u-me", "desktop_session")
    ).content[0].text;

    expect(text).toContain("re-arm the wait NOW");
    expect(text).not.toContain("Do NOT re-arm");
  });
});

// ── the static description cannot branch, so it may not claim ──────────

describe("CHANNEL_DESCRIPTION — runtime-neutral and honest", () => {
  function channelDescription(): string {
    let description = "";
    const capture: RegisterTool = (_name, desc) => {
      description = desc;
    };
    registerChannelTool(capture, {} as DoplClient);
    return description;
  }

  it("carries none of the unconditional wake promises", () => {
    expectNoFalsePromise(channelDescription());
  });

  it("still teaches that an armed await is what brings a reply back", () => {
    const description = channelDescription();
    expect(description).toContain("CALL IT BEFORE YOU END YOUR TURN");
    expect(description).toContain("returns INSIDE your turn");
    expect(description).toContain("background a call still pending past ~2 minutes");
    // ...and the desktop-session escape hatch, which the static text CAN state
    // conditionally because it addresses every caller at once.
    expect(description).toContain(`do NOT call "await" at all`);
  });
});
