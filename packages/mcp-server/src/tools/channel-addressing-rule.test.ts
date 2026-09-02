/**
 * THE ADDRESSING RULE, pinned against the code that implements it: whether the
 * SENTENCES this tool emits about who a message reaches are TRUE. Each test
 * fails if a known-false claim comes back:
 *
 *   ⚠ "an unaddressed post triggers no agent, including in a two-member
 *     channel" — `classify` keys the implicit trigger on `memberCount === 2`
 *     (main/targeting.js) and never reads `is_direct`, so an agent told
 *     otherwise re-posts with `to=` and the peer gets two consent prompts.
 *   ⚠ "nobody was woken by it", said about a THREADED post — three routes run
 *     before `classify` (listener-messages.js) and none reads `to_user_id`: a
 *     first-class thread tag feeds the counterparty's live session directly.
 *   ⚠ "NONE of the messages above is addressed to you … do not answer them" —
 *     the canonical reply here is UNADDRESSED (`channel-post.js › postResult`,
 *     `prompt-framing.js › deliveryCall`), so this tells a requester its own
 *     answer is somebody else's traffic.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import {
  AWAIT_UNNAMED_NOTICE,
  GROUP_CHANNEL_MIN_MEMBERS,
  routesToASession,
  rosterAddressingRule,
  unaddressedPostNote,
} from "./channel-addressing";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { opAwait } from "./channel-ops-await";
import { opMembers } from "./channel-ops-read";
import { opPost } from "./channel-ops-write";

const ME = "u-me";
const PEER = "u-peer";
/** A first-class thread id — the only shape the desktop routes on. */
const UUID = "3f1c2b90-7a44-4c2e-9b11-0d8e6a5c4321";
/** The deterministic legacy shape (`task-<channel>-<seq>`) — routes nowhere. */
const LEGACY = "task-chan-1-7";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

function member(userId: string) {
  return {
    channelId: "chan-1",
    userId,
    role: "member",
    lastReadAt: null,
    addedBy: null,
    joinedAt: "2026-07-01T00:00:00Z",
    displayName: null,
    email: null,
  };
}

function postClient(
  channel: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): DoplClient {
  return {
    listChannels: vi.fn(async () => [{ ...CHANNEL, ...channel }]),
    postChannelMessage: vi.fn(async () => ({
      id: "m1",
      seq: 12,
      kind: "message",
      metadata,
      authorUserId: ME,
    })),
    listChannelThreads: vi.fn(async () => ({ threads: [], truncated: false })),
  } as unknown as DoplClient;
}

function rosterClient(userIds: string[]): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listChannelMembers: vi.fn(async () => userIds.map(member)),
  } as unknown as DoplClient;
}

// ── the two lanes state ONE number ───────────────────────────────────

describe("the group-channel threshold is not restated per lane", () => {
  it("matches the web app's GROUP_CHANNEL_MIN_MEMBERS", () => {
    // ⚠ This package cannot import across the boundary — pin the copy rather
    // than trust it to stay in step. (The web tree's last BRANCH on the number
    // went with the invite-dialog note on 2026-08-18; the constant is still
    // declared there, and the two declarations must not drift.)
    const web = readFileSync("../../src/features/channels/constants.ts", "utf8");
    const declared = /GROUP_CHANNEL_MIN_MEMBERS = (\d+)/.exec(web);
    expect(declared, "the web constant moved or was renamed").not.toBeNull();
    expect(Number(declared![1])).toBe(GROUP_CHANNEL_MIN_MEMBERS);
  });

});


describe("the removed named-agent surface is ABSENT from the published shape", () => {
  it("declares no to_agent / to_agents / as_agent / participants / agent / status", () => {
    // ⚠ Not "declared and ignored" — a param an MCP client can see is a param a
    // model will try, and a silently-dropped address is the invisible-delivery
    // failure the addressing contract exists to prevent.
    for (const key of ["to_agent", "to_agents", "as_agent", "participants", "agent", "status"]) {
      expect(CHANNEL_INPUT_SHAPE, key).not.toHaveProperty(key);
    }
  });

  it("REFUSES every removed op at the enum, before any handler runs", () => {
    // ⚠ DROPPED rather than kept for a teaching refusal: these capabilities are
    // gone, so "invalid enum value" is the honest answer. `close_thread` WAS the
    // counter-example here — kept in the enum because its capability had moved
    // to `propose_close` — and both left with thread closing (wiring plan
    // Phase 4, 2026-08-18), which is the rule stated the other way round: a
    // teaching refusal is only honest while there is something to teach.
    // ⚠ SIX, NOT SEVEN, SINCE 2026-09-01. `rename_agent` IS ACCEPTED AGAIN and is
    // a different verb: the retired one changed a named agent's channel-visible
    // ADDRESS; this one sets a LOCAL DISPLAY LABEL stored on one machine
    // (`main/agent-names.js`), reaching no server and addressing nobody — the
    // same verb the in-process `mcp__dopl_agents__rename_agent` has carried since
    // 2026-08-31. The argument in full is on
    // `channel-law.test.ts › REMOVED_VOCABULARY`'s lifecycle entry.
    // ⚠ WHAT THIS FILE GUARDS IS UNCHANGED AND IS ASSERTED HARDER, not relaxed:
    // the case below still requires that NO param named `agent` exists, and the
    // addressing contract still has exactly one address — `@agent-<id>`.
    for (const op of [
      "agents",
      "summon_agent",
      "set_agent_status",
      "disengage_agent",
      "join_thread",
      "leave_thread",
    ]) {
      expect(
        CHANNEL_INPUT_SHAPE.op.safeParse(op).success,
        `op="${op}" is still accepted`,
      ).toBe(false);
    }
  });

  /**
   * ⚠ **THE REVIVED WORD DOES NOT REVIVE THE SURFACE**, and this is the case that
   * says so. The retired `rename_agent` belonged to a model where an agent was a
   * named channel participant and its name ROUTED; the property that mattered was
   * never the spelling, it was that no name is an address.
   */
  it("the revived rename_agent brought back NO addressing surface", () => {
    expect(CHANNEL_INPUT_SHAPE.op.safeParse("rename_agent").success).toBe(true);
    // ⚠ It reuses `agent_id` — an INSTANCE id on the caller's own machine — and
    // introduces no param of its own. A param literally named `agent` is still
    // banned by the case above; `name` already existed for op="open".
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("agent_id");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("agent");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("as_agent");
  });

  it("still accepts every op that SURVIVED, so the rollback took nothing extra", () => {
    for (const op of [
      "list",
      "open",
      "invite",
      "post",
      "milestone",
      "read",
      "await",
      "members",
      "list_threads",
      "get_thread",
      "create_thread",
      // ⚠ `propose_close` and `close_thread` were on this list until thread
      // closing was removed (wiring plan Phase 4, 2026-08-18). `close_thread`
      // was kept in the enum ON PURPOSE so an older agent got a teaching
      // refusal rather than an opaque enum error — a trade that only pays
      // while there is something to do instead.
      "set_thread_mode",
    ]) {
      expect(
        CHANNEL_INPUT_SHAPE.op.safeParse(op).success,
        `op="${op}" was lost`,
      ).toBe(true);
    }
  });

  it("refuses the two ops thread closing took with it", () => {
    // ⚠ The enum is the gate: `close_thread` used to be IN it, answered with a
    // teaching refusal. With nothing to teach instead, a stale caller gets a
    // -32602 — which is the accepted cost of the words surviving nowhere in the
    // shipped surface (`channel-law.test.ts › REMOVED_VOCABULARY`).
    for (const op of ["propose_close", "close_thread"]) {
      expect(
        CHANNEL_INPUT_SHAPE.op.safeParse(op).success,
        `op="${op}" came back`,
      ).toBe(false);
    }
  });
});

// ── which thread tags actually route ─────────────────────────────────

describe("routesToASession — first-class only", () => {
  it("is true for a uuid thread id and false for everything else", () => {
    // ⚠ Mirrors `firstClassTaskId` (targeting.js): pre-classify routes call it
    // and it returns '' for a legacy id, so only a uuid reaches a session.
    expect(routesToASession(UUID)).toBe(true);
    expect(routesToASession(UUID.toUpperCase())).toBe(true);
    expect(routesToASession(LEGACY)).toBe(false);
    expect(routesToASession(undefined)).toBe(false);
    expect(routesToASession("")).toBe(false);
    expect(routesToASession(`${UUID} `)).toBe(false);
  });
});

// ── the post note ────────────────────────────────────────────────────

describe("unaddressedPostNote", () => {
  const base = { ref: "chan-1", isDirect: false, landedThread: undefined };

  it("says nothing ONLY when the caller addressed someone", () => {
    expect(unaddressedPostNote({ ...base, addressed: true })).toBeNull();
  });

  /**
   * ⚠ INVERTED 2026-08-18 (wiring plan Phase 3). This used to assert `null` for
   * a DIRECT channel, because `resolveDirectPeer` stamped the other member
   * server-side. That fallback is retired: an unaddressed DM post reaches
   * nobody's agent like any other, and staying quiet about it is exactly the
   * invisible-delivery failure this module exists to prevent.
   */
  it("WARNS in a direct channel too — nothing addresses a post for you now", () => {
    const note = unaddressedPostNote({ ...base, isDirect: true, addressed: false });
    expect(note).toContain("NOT ADDRESSED");
    expect(note).toContain("That holds in a DIRECT (1:1) message too");
  });

  it("names the AUTHOR KIND as the reason, never the member count", () => {
    const note = unaddressedPostNote({ ...base, addressed: false })!;
    expect(note).toContain("NOT ADDRESSED");
    expect(note).toContain("from an AGENT is never taken as an implicit request");
    // ⚠ A two-member channel is NOT one where an unaddressed message reaches
    // nobody — that claim produces duplicate requests.
    expect(note).not.toContain("nobody was woken");
    expect(note).not.toMatch(/including a two-member/i);
  });

  it("does NOT claim silence for a post that landed on a first-class thread", () => {
    const note = unaddressedPostNote({
      ...base,
      addressed: false,
      landedThread: UUID,
    })!;
    expect(note).toContain("NOT ADDRESSED, BUT THREADED");
    expect(note).toContain("may be in front of their agent right now");
    // ⚠ Remedy must not be "re-post with to=" — that manufactures a duplicate.
    expect(note).toContain("Do NOT re-post it with `to=`");
    expect(note).not.toMatch(/re-post it with to="/);
  });

  it("keeps the plain note for a LEGACY tag, which routes to no session", () => {
    const note = unaddressedPostNote({
      ...base,
      addressed: false,
      landedThread: LEGACY,
    })!;
    expect(note).not.toContain("BUT THREADED");
    expect(note).toContain("from an AGENT is never taken as an implicit request");
  });
});

describe("post — the note and the linkage line in one result", () => {
  it("a threaded post never says nobody was woken next to 'reads this as a continuation'", async () => {
    const client = postClient({ isDirect: false }, { taskId: UUID });

    const text = (await opPost(client, "general", "here is the diff")).content[0]
      .text;

    expect(text).toContain("NOT ADDRESSED, BUT THREADED");
    expect(text).toContain("the other side reads this as a continuation");
    expect(text).not.toContain("nobody was woken");
    expect(text).not.toContain("NO member's agent was triggered");
  });

  it("an unthreaded post still tells the sender it has to address a member", async () => {
    const client = postClient({ isDirect: false });

    const text = (await opPost(client, "general", "anyone free?")).content[0]
      .text;

    expect(text).toContain("NOT ADDRESSED");
    expect(text).not.toContain("BUT THREADED");
    expect(text).toContain('re-post it with to="<one member>"');
  });

  it("warns in a DIRECT channel too, and still names the thread it landed in", async () => {
    // ⚠ Inverted with the DM auto-address retirement (2026-08-18). A threaded
    // post takes the THREADED shape of the note, which tells the caller to WAIT
    // rather than re-post — the one remedy that would double the request.
    const client = postClient({ isDirect: true }, { taskId: UUID });

    const text = (await opPost(client, "general", "ping")).content[0].text;

    expect(text).toContain("NOT ADDRESSED, BUT THREADED");
    expect(text).toContain("Do NOT re-post it");
  });
});

// ── the roster rule ──────────────────────────────────────────────────

describe("rosterAddressingRule — stated from the count it just read", () => {
  /** ⚠ INVERTED 2026-08-18: the implicit two-member request is retired. Two
   *  members is no longer a special size, and the copy has to stop saying it
   *  is — a caller told otherwise leaves `to` off and reaches nobody. */
  it("at two members, an unaddressed message reaches nobody EITHER", () => {
    const rule = rosterAddressingRule("general", 2);
    expect(rule).toContain("the size buys you nothing");
    expect(rule).not.toContain("Two members is the ONE size");
    expect(rule).not.toMatch(/implicit request/i);
  });

  it("at three or more it really does reach nobody, and says so with the number", () => {
    expect(rosterAddressingRule("general", GROUP_CHANNEL_MIN_MEMBERS)).toContain(
      "With 3 members, an UNADDRESSED, UNTHREADED post reaches no one's agent",
    );
    expect(rosterAddressingRule("general", 9)).toContain("With 9 members");
    expect(rosterAddressingRule("general", 9)).not.toContain("implicit request");
  });

  it("never claims the auto-addressing half it cannot see", () => {
    for (const n of [1, 2, 3, 9]) {
      const rule = rosterAddressingRule("general", n);
      // ⚠ The hedge it used to carry ("this op reads the roster, not the
      // channel row, so it cannot tell you whether this is one") is GONE, and
      // its absence is the assertion: there is no direct-channel case left to
      // be unsure about.
      expect(rule).not.toContain("it cannot tell you whether this is one");
      expect(rule).toContain("NOTHING addresses a post for you");
      expect(rule).not.toMatch(/including a two-member/i);
      // ⚠ At every size a thread tag routes past the addressing entirely, so no
      // branch may say an unaddressed post reaches nobody without that caveat.
      expect(rule).toContain("routes the post into the session already working it");
    }
  });

  it("a roster of one has nobody to address", () => {
    expect(rosterAddressingRule("general", 1)).toContain(
      "nobody else on this roster to address",
    );
  });
});

describe("members — the rule reaches the result", () => {
  it("a two-member roster is told it is not a special size", async () => {
    const text = (await opMembers(rosterClient([ME, PEER]), "general", ME))
      .content[0].text;

    expect(text).toContain("the size buys you nothing");
    expect(text).not.toContain("Two members is the ONE size");
  });

  it("a three-member roster is told the group rule", async () => {
    const text = (await opMembers(rosterClient([ME, PEER, "u-c"]), "general", ME))
      .content[0].text;

    expect(text).toContain("With 3 members, an UNADDRESSED, UNTHREADED post reaches no one's agent");
    expect(text).not.toContain("Two members is the ONE size");
  });
});

// ── the await notice ─────────────────────────────────────────────────

describe("AWAIT_UNNAMED_NOTICE — a wake that names nobody", () => {
  it("does not tell a waiting agent that its own answer belongs to someone else", () => {
    // ⚠ `postResult` posts a responder's reply with no `toUserId` and
    // `deliveryCall` teaches the delivery call with no `to`, so "nothing here
    // is addressed to you" cannot narrow to "none of this is yours".
    expect(AWAIT_UNNAMED_NOTICE).toContain("a reply here is normally posted UNADDRESSED");
    expect(AWAIT_UNNAMED_NOTICE).toContain("that is your reply");
    expect(AWAIT_UNNAMED_NOTICE).not.toContain("Do not answer them");
    expect(AWAIT_UNNAMED_NOTICE).not.toContain("they are context.");
  });

  it("accounts for threading, which the addressing field cannot express", () => {
    expect(AWAIT_UNNAMED_NOTICE).toContain(
      "THREADED into an exchange you are a party to is for you",
    );
  });

  it("still refuses another member's request", () => {
    expect(AWAIT_UNNAMED_NOTICE).toContain("aimed at another member");
    expect(AWAIT_UNNAMED_NOTICE).toContain("adopt an unaddressed message as a task you were assigned");
  });
});

// ── ...and WHEN it fires, a separate claim ───────────────────────────
//
// ⚠ Premise is "somebody ELSE wrote things and none names you". A predicate
// running over the caller's OWN posts fires on a page holding only the caller's
// own request and tells the agent it does not name them. `excludeAuthor` should
// keep own posts out; this is the second line of defence, because the notice
// must be false-free on whatever it is handed.

describe("AWAIT_UNNAMED_NOTICE — over messages SOMEONE ELSE wrote", () => {
  function awaitClient(messages: Array<Record<string, unknown>>): DoplClient {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    return {
      listChannels: vi.fn(async () => [CHANNEL]),
      awaitChannelMessages: vi.fn(async () => ({ messages, timedOut: false })),
    } as unknown as DoplClient;
  }

  function message(
    seq: number,
    authorUserId: string,
    toUserId?: string,
  ): Record<string, unknown> {
    return {
      id: `m-${seq}`,
      seq,
      channelId: "chan-1",
      authorUserId,
      authorKind: "agent",
      kind: "message",
      body: "the body",
      metadata: toUserId ? { to_user_id: toUserId } : {},
      clientMsgId: null,
      createdAt: "2026-07-31T00:00:00Z",
    };
  }

  async function noticeFor(
    messages: Array<Record<string, unknown>>,
    selfUserId: string | null = ME,
  ): Promise<string> {
    const res = await opAwait(awaitClient(messages), "general", 7, undefined, selfUserId);
    return res.content[0].text;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says NOTHING when every message on the page is the caller's own", async () => {
    const text = await noticeFor([message(8, ME, PEER)]);
    expect(text).not.toContain("NONE of the messages above NAMES you");
  });

  it("still fires when a peer wrote something that names nobody", async () => {
    expect(await noticeFor([message(8, PEER)])).toContain(
      "NONE of the messages above NAMES you",
    );
  });

  it("stays silent when a peer's message DOES name the caller", async () => {
    expect(await noticeFor([message(8, PEER, ME)])).not.toContain(
      "NONE of the messages above NAMES you",
    );
  });

  it("judges the peer's messages alone — the caller's own can't suppress it", async () => {
    // Mixed page — the notice is about theirs; mine changes nothing.
    expect(await noticeFor([message(8, ME, PEER), message(9, PEER)])).toContain(
      "NONE of the messages above NAMES you",
    );
  });

  it("says nothing at all when the caller's own id is unknown", async () => {
    expect(await noticeFor([message(8, PEER)], null)).not.toContain(
      "NONE of the messages above NAMES you",
    );
  });
});
