/**
 * ⚠ THE WAKE PROMISE IS CONDITIONAL, AND THE SERVER KNOWS WHICH CASE IT IS IN.
 * A pending call KEEPS a turn alive; it cannot end one, and backgrounding it is
 * a CLIENT behaviour this server does not provide. An unconditional "that call
 * keeps running after your turn ends and wakes you" is false for an external
 * session, whose ~215s hold runs to completion INSIDE the same turn.
 *
 * The discriminating signal is `X-Dopl-Runtime` → `CallerIdentity.runtime`.
 * Both halves pinned: the STAMPED branch drops the promise and says do not arm;
 * the UNSTAMPED branch promises nothing and describes the hold. ⚠ The exact
 * false sentences are pinned as ABSENCES — a later edit restoring the old
 * wording is the whole regression.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { RegisterTool } from "./respond";
import { DESKTOP_SESSION_RUNTIME } from "./identity";
import { opAwait } from "./channel-ops-await";
import { opPost } from "./channel-ops-write";
import { opCreateThread } from "./channel-ops-threads";
import { registerChannelTool } from "./channel";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const BOB = { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" };

/**
 * ⚠ Every phrasing of "this call outlives your turn". None may appear for ANY
 * caller: wrong for a desktop session, unknowable for an unstamped one.
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
    // ⚠ Reported as an OBSERVATION — what the request CARRIED, never a
    // conclusion about where anything runs.
    expect(text).toContain("carried the Dopl desktop's runtime stamp");
    expect(text).not.toContain("external");
    // ⚠ Arming instruction GONE — not softened, not conditional.
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
    // Still armed — the caller for whom await IS the mechanism.
    expect(text).toContain("Expecting a reply?");
    expect(text).toContain('since=12');
    // ...described honestly: synchronous, in-turn, CONDITIONAL wake.
    expect(text).toContain("RETURNS INSIDE your current turn");
    expect(text).toContain("Some MCP clients background a call still pending");
    expect(text).toContain("if yours does");
    // ⚠ Stop conditions are load-bearing and must survive this branch.
    expect(text).toContain("STOP and report to your operator");
    expect(text).toContain("30+ minutes");
    // ⚠ An unstamped caller may still BE a desktop session on an older build,
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
    // ⚠ Stop rule rides with EVERY re-arm instruction.
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

  // The wake an external session can build for itself: `await` returns inside
  // the turn that armed it, but a harness running background shell tasks
  // already delivers completion as a wake, so the poll can move out of the MCP
  // call. ⚠ Stated ONCE, conditionally, and only where we cannot see the
  // caller — a desktop session is fed replies and must not build a second
  // delivery path for them.
  it("offers the background-task poll to every unstamped surface", async () => {
    const surfaces = [
      (await opPost(stubClient(), "general", "please do X", { to: "bob@x.com" }))
        .content[0].text,
      (
        await opCreateThread(stubClient(), "general", "Ship it", "please do X", "bob@x.com")
      ).content[0].text,
      (await opAwait(quietClient(), "general", 7, undefined, "u-me")).content[0].text,
      (await opAwait(arrivingClient(), "general", 7, undefined, "u-me")).content[0].text,
    ];

    for (const text of surfaces) {
      expectNoFalsePromise(text);
      // ⚠ CONDITIONAL on a capability we cannot observe — never a promise.
      expect(text).toContain("If your harness can run background shell tasks");
      expect(text).toContain("scripts/dopl-channel-wait.sh");
      expect(text).toContain("END your turn");
      expect(text).toContain("a wake your client already delivers");
    }
  });

  it("does NOT offer it to a desktop session, which is already fed replies", async () => {
    const text = (
      await opAwait(quietClient(), "general", 7, undefined, "u-me", DESKTOP_SESSION_RUNTIME)
    ).content[0].text;

    expect(text).not.toContain("background shell tasks");
    expect(text).not.toContain("dopl-channel-wait.sh");
  });

  it("an unrecognized stamp is treated as unstamped, never as its own case", async () => {
    // ⚠ Only the EXACT recognized value counts — a near-miss falls to the
    // honest branch, never to the desktop one.
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
