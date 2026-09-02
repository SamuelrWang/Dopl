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
// ⚠ WHERE THE HOLD MECHANICS LIVE SINCE T10/T12 (2026-09-02). `post` and
// `create_thread` used to close with three paragraphs each — the hold, the stop
// rule, the skip clause. All three are standing doctrine and are re-pinned on
// CHANNEL_DOCTRINE below; what SURVIVES in a write result is the one thing that
// is a fact about the call, the `await=` branch off the observed runtime.
import { CHANNEL_DOCTRINE, DOCTRINE_URI } from "./channel-doctrine";
import { UNTRUSTED_BODY_HEADER } from "./channel-framing";

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
    listChannelThreads: vi.fn(async () => ({ threads: [], truncated: false })),
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
    // ⚠ `await=skip` IS THE WHOLE OF "DO NOT ARM", and it is the ONE thing on
    // this decision that is a FACT about the call rather than standing doctrine:
    // only the server saw whether THIS request carried the desktop's stamp.
    expect(text).toContain("await=skip");
    // ⚠ AND NO CURSOR IS OFFERED. Handing a stamped session a `since:` to arm
    // from is the whole failure this branch exists to prevent.
    expect(text).not.toContain("await=since:");
    expect(text).not.toContain("since=12");
    // ⚠ Arming instruction GONE — not softened, not conditional.
    expect(text).not.toContain("Expecting a reply?");
    expect(text).not.toContain("external");
    // ⚠ MOVED, NOT DELETED: WHY a fed session must not arm. (The OBSERVATION
    // framing — "this request CARRIED the stamp", never "you are a desktop" —
    // survives verbatim in the `await` results pinned further down this file.)
    expect(CHANNEL_DOCTRINE).toContain(
      "SKIP THE AWAIT ENTIRELY if this session already receives the counterparty's replies as new turns",
    );
  });

  it("create_thread tells it not to arm, and says the thread was addressed", async () => {
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
    expect(text).toContain("await=skip");
    expect(text).not.toContain("await=since:");
    // ⚠ THE ADDRESSEE IS A FACT, THE LABEL WAS NOT. "Bob" was the caller's own
    // argument one line ago; `addressed=yes` is what the server established —
    // that the member RESOLVED and the thread has a second party who may post
    // into it. Losing that token is what would leave a thread nobody can answer
    // looking identical to one that is addressed.
    expect(text).toContain("addressed=yes");
    expect(text).toContain("thread=thread-1");
    expect(text).not.toContain("Now WATCH FOR THE REPLY");
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
    // ⚠ THE BANNER RIDES BOTH AWAIT LANES ON EVERY RUNTIME (F-407). What the
    // desktop stamp changes is the RE-ARM advice above, not the framing: the
    // body is peer-written either way.
    expect(text).toContain(UNTRUSTED_BODY_HEADER);
  });
});

// ── unstamped: promise nothing, describe the hold ─────────────────────

describe("unstamped runtime — the wake is the CLIENT's, and is stated as one", () => {
  it("post describes the hold instead of promising it outlives the turn", async () => {
    const text = (
      await opPost(stubClient(), "general", "please do X", { to: "bob@x.com" })
    ).content[0].text;

    expectNoFalsePromise(text);
    // Still armed — the caller for whom await IS the mechanism — and the cursor
    // is pre-computed off the seq this write just produced, so arming costs no
    // extra read. ⚠ `since:12`, never `since:0`: awaiting from 0 replays the
    // channel.
    expect(text).toContain("await=since:12");
    expect(text).not.toContain("await=skip");
    // ⚠ THE THREE PARAGRAPHS ARE GONE FROM THE RESULT AND MUST STAY GONE...
    expect(text).not.toContain("Expecting a reply?");
    expect(text).not.toContain("RETURNS INSIDE your current turn");
    // ...AND MUST STAY IN THE PRODUCT. Described honestly there: synchronous,
    // in-turn, CONDITIONAL wake, with the load-bearing stop rule, and with the
    // escape hatch for a caller who may still BE a desktop session on an older
    // build — exactly the case the stamp cannot tell us about.
    expect(CHANNEL_DOCTRINE).toContain("RETURNS INSIDE your current turn");
    expect(CHANNEL_DOCTRINE).toContain(
      "Some MCP clients background a call still pending",
    );
    expect(CHANNEL_DOCTRINE).toContain("if yours does");
    expect(CHANNEL_DOCTRINE).toContain("STOP and report to your operator");
    expect(CHANNEL_DOCTRINE).toContain("30+ minutes");
    expect(CHANNEL_DOCTRINE).toContain("SKIP THE AWAIT ENTIRELY");
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
    // ⚠ SAME BRANCH, SAME TOKEN, off the OPENING message's seq — so the reply
    // is the very next message the armed await returns.
    expect(text).toContain("await=since:41");
    expect(text).not.toContain("await=skip");
    expect(text).not.toContain("Now WATCH FOR THE REPLY");
    expect(CHANNEL_DOCTRINE).toContain("RETURNS INSIDE your current turn");
    expect(CHANNEL_DOCTRINE).toContain("STOP and report to your operator");
  });

  /**
   * ⚠ THE TIMEOUT IS THE COMPRESSED RESULT SINCE T03, and this is the one place
   * the difference is worth stating: a polling orchestrator reads this text
   * every ~45s, unchanged, so restating what a pending call does is paid per
   * empty hold to say nothing new. What survives is everything that is a FACT
   * about this hold rather than about the mechanism — the cursor, the re-arm
   * call, and the stop rule INVARIANTS §10 requires of any re-arm instruction.
   */
  it("a timed-out await re-arms compactly, cursor first, nothing promised", async () => {
    const text = (await opAwait(quietClient(), "general", 7, undefined, "u-me"))
      .content[0].text;

    expectNoFalsePromise(text);
    expect(text).toContain("cursor=7");
    expect(text).toContain("re-arm the wait NOW");
    expect(text).toContain("since=7");
    // ⚠ Stop rule rides with EVERY re-arm instruction — and since thread
    // closing was removed (wiring plan Phase 4, 2026-08-18) it is the
    // addressee's silence, said out loud as the ONLY signal there is.
    expect(text).toContain("Keep re-arming while something came from that member");
    expect(text).toContain("no finished STATE to wait for");
    expect(text).toContain("STOP and report to your operator");
    // ⚠ Pinned as ABSENCES: the mechanism lecture is taught where it is NEW
    // (post, create_thread, and the hold that returned), not re-read on every
    // empty hold of a poll loop.
    expect(text).not.toContain("RETURNS INSIDE your current turn");
    expect(text).not.toContain("Some MCP clients background a call still pending");
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
  it("offers the background-task poll on every unstamped surface that ARMS", async () => {
    // ⚠ THE OFFER RODE FOUR SURFACES AND NOW RIDES TWO — the `await` results,
    // which are the ones a caller reads while DECIDING whether to keep holding.
    // The two WRITE results dropped it with the rest of their standing prose
    // (T10/T12); the pattern itself is unchanged and is asserted on the doctrine
    // below, so this is a move rather than a removal.
    const armingSurfaces = [
      (await opAwait(arrivingClient(), "general", 7, undefined, "u-me")).content[0].text,
    ];

    for (const text of armingSurfaces) {
      expectNoFalsePromise(text);
      // ⚠ CONDITIONAL on a capability we cannot observe — never a promise. ⚠ And
      // it NAMES A SCRIPT rather than implying the server provides one.
      expect(text).toContain("If your harness can run background shell tasks");
      expect(text).toContain("scripts/dopl-channel-wait.sh");
      expect(text).toContain("END your turn");
      expect(text).toContain("a wake your client already delivers");
    }

    // ⚠ AND THE TIMED-OUT HOLD IS ON THE SILENT SIDE, WITH THE TWO WRITES. It is
    // the ONE result an orchestrator reads over and over — every ~45s on a quiet
    // exchange, saying the same thing each time — so T03 cut it to a bare
    // `cursor=<seq>` plus the re-arm rule. The hint is offered on the results
    // that are read ONCE. ⚠ Two tiers reached this line from opposite ends (T03
    // stripped the timeout, T10/T12 stripped the writes) and this is the union:
    // the pattern is asserted on the doctrine below, so nothing was removed.
    const writeSurfaces = [
      (await opAwait(quietClient(), "general", 7, undefined, "u-me")).content[0].text,
      (await opPost(stubClient(), "general", "please do X", { to: "bob@x.com" }))
        .content[0].text,
      (
        await opCreateThread(stubClient(), "general", "Ship it", "please do X", "bob@x.com")
      ).content[0].text,
    ];
    for (const text of writeSurfaces) {
      expectNoFalsePromise(text);
      expect(text).not.toContain("background shell tasks");
      // ...but each still hands back the CURSOR that makes the poll possible —
      // `await=since:<seq>` on a write, a bare `cursor=<seq>` on the timeout.
      expect(text).toMatch(/await=since:|cursor=\d+/);
    }
    expect(CHANNEL_DOCTRINE).toContain("If your harness can run background shell tasks");
    expect(CHANNEL_DOCTRINE).toContain("END your turn");
    expect(CHANNEL_DOCTRINE).toContain("a wake your client already delivers");
  });

  it("does NOT offer it to a desktop session, which is already fed replies", async () => {
    const text = (
      await opAwait(quietClient(), "general", 7, undefined, "u-me", DESKTOP_SESSION_RUNTIME)
    ).content[0].text;

    expect(text).not.toContain("background shell tasks");
    expect(text).not.toContain("dopl-channel-wait.sh");
  });

  /**
   * ⚠ THE REGRESSION THE ADAPTER PORT'S STEP 1 WOULD OTHERWISE SHIP SILENTLY
   * (2026-08-31). A Codex or Cursor session driven by the desktop is still a
   * session the desktop SPAWNED and is still fed the counterparty's replies as
   * new turns, so it must land in THIS branch. It does, and only because the
   * vendor became a SECOND header dimension (`X-Dopl-Vendor`) instead of a
   * fourth value of the custody enum: `isDesktopRuntime` is a strict equality,
   * so a session stamped `codex` here would fall to the unstamped branch and be
   * taught to arm and re-arm an await that will never wake it.
   */
  it("stays true for a NON-CLAUDE desktop session — custody, not vendor", async () => {
    // What a Dopl-driven Codex session sends: the same custody stamp. The
    // vendor rides `X-Dopl-Vendor` and never reaches this argument.
    const text = (
      await opAwait(quietClient(), "general", 7, undefined, "u-me", DESKTOP_SESSION_RUNTIME)
    ).content[0].text;

    expect(text).toContain("Do NOT re-arm");
    expect(text).not.toContain("re-arm the wait NOW");
  });

  it("...and a VENDOR word in the runtime slot falls to unstamped, as it must", async () => {
    // The failure mode stated as a test: if a future change ever widens the
    // custody enum with a vendor word, this is what those sessions would get.
    for (const vendorWord of ["codex", "cursor", "claude"]) {
      const text = (
        await opAwait(quietClient(), "general", 7, undefined, "u-me", vendorWord)
      ).content[0].text;
      expect(text).toContain("re-arm the wait NOW");
      expect(text).not.toContain("Do NOT re-arm");
    }
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

  it("still teaches that an armed await is what brings a reply back — via the doctrine", () => {
    // ⚠ THE TEACHING MOVED ONE DOOR OUT (T82, 2026-09-02). This string was
    // ~35k chars PUSHED to every client on every connection, including the ones
    // that never open a channel; it is a pointer now. So the property splits in
    // two, and BOTH halves are asserted — the description must still get a
    // reader to the text, and the text must still say the thing.
    const description = channelDescription();
    expect(description).toContain('op="help"');
    expect(description).toContain(DOCTRINE_URI);
    expect(description).toContain('"await"');
    // The hold, said as what it provably is...
    expect(CHANNEL_DOCTRINE).toContain("RETURNS INSIDE your current turn");
    expect(CHANNEL_DOCTRINE).toContain("background a call still pending past ~2 minutes");
    expect(CHANNEL_DOCTRINE).toContain('call "await" with since=<the last seq you saw>');
    // ...and the desktop-session escape hatch, which the static text CAN state
    // conditionally because it addresses every caller at once.
    expect(CHANNEL_DOCTRINE).toContain("SKIP THE AWAIT ENTIRELY");
  });
});
