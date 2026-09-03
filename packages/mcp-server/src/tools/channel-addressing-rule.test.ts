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
 *
 * ⚠ THE THIRD CLAIM — the `AWAIT_UNNAMED_NOTICE`, which must not tell a
 * requester its own answer is somebody else's traffic — moved to
 * `channel-addressing-await-notice.test.ts` on 2026-09-02, at the §1 cap. The
 * seam is SUBJECT: what a WRITE reports about who it reached stays here; what a
 * HOLD says about a page somebody else wrote is over there.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import type { ChannelMessage, DoplClient } from "@dopl/client";
import {
  GROUP_CHANNEL_MIN_MEMBERS,
  rosterAddressingRule,
} from "./channel-addressing";
// ⚠ THE ONE PREDICATE (T10, 2026-09-02). `routesToASession` was a DUPLICATE of
// this; deleting it deleted a second regex for "is this a real thread", not a
// rule. Fact 3 of `channel-addressing.ts` is unchanged and is still why the
// distinction matters — the write and read lanes now share one definition.
import { isFirstClassThreadId } from "./channel-render-threads";
import { threadFacts } from "./channel-post-linkage";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
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
      id: "m1", seq: 12, kind: "message", metadata, authorUserId: ME,
    })),
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
  it("the revived rename brought back NO addressing surface", () => {
    // ⚠ B8: `op="rename_agent"` is `op="manage" action="rename"`, and slice B16
    // retired the old spelling for good — it parsed for one release so its
    // redirect could run. ⚠ RE-POINTED: `agent_id` folded into the ONE recipient
    // field, so the instance renamed is `to` and `name` pre-existed — still no
    // param of its own, and `agent` is still banned by the case above.
    expect(CHANNEL_INPUT_SHAPE.op.safeParse("rename_agent").success).toBe(false);
    expect(CHANNEL_INPUT_SHAPE.op.safeParse("manage").success).toBe(true);
    expect(CHANNEL_INPUT_SHAPE.action.safeParse("rename").success).toBe(true);
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("to");
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("name");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("agent");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("as_agent");
  });

  /**
   * ⚠ **THE ROLLBACK TOOK NO CAPABILITY, AND THIS IS THE CASE THAT SAYS SO** —
   * restated at slice B16 as a pair of live words rather than a list of parsing
   * names. Every concept the named-agent surface had is still reachable; what
   * changed twice is only its SPELLING (B8 collapsed 23 ops to 5, B16 stopped
   * the old spellings parsing). Asserting the old names still parsed would now
   * assert the compatibility window, which is the thing that closed.
   */
  it("every surviving CONCEPT is still reachable, under a live op", () => {
    const reachable: ReadonlyArray<readonly [string, string | null]> = [
      ["send", null], //          post · milestone · escalate · create_thread
      ["read", null], //          read · await (`wait_ms`) · get_thread (`thread=`)
      ["status", null], //        read_sessions · read_directions
      ["rooms", "list"],
      ["rooms", "open"],
      ["rooms", "invite"],
      ["rooms", "members"],
      ["rooms", "threads"],
      ["rooms", "thread_mode"],
      ["rooms", "update"],
      ["rooms", "help"],
      ["manage", "launch"],
      ["manage", "end"],
      ["manage", "rename"],
      ["manage", "posture"],
      ["manage", "direct"],
    ];
    for (const [op, action] of reachable) {
      expect(
        CHANNEL_INPUT_SHAPE.op.safeParse(op).success,
        `op="${op}" was lost`,
      ).toBe(true);
      if (action !== null) {
        expect(
          CHANNEL_INPUT_SHAPE.action.safeParse(action).success,
          `action="${action}" was lost`,
        ).toBe(true);
      }
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

describe("isFirstClassThreadId — first-class only, and ONE definition of it", () => {
  it("is true for a uuid thread id and false for everything else", () => {
    // ⚠ Mirrors `firstClassTaskId` (targeting.js): pre-classify routes call it
    // and it returns '' for a legacy id, so only a uuid reaches a session.
    expect(isFirstClassThreadId(UUID)).toBe(true);
    expect(isFirstClassThreadId(UUID.toUpperCase())).toBe(true);
    expect(isFirstClassThreadId(LEGACY)).toBe(false);
    expect(isFirstClassThreadId("")).toBe(false);
    expect(isFirstClassThreadId(`${UUID} `)).toBe(false);
  });

  it("⚠ AND THE WRITE LANE DECIDES `landed=` WITH THAT SAME FUNCTION", () => {
    // ⚠ TWO REGEXES FOR "IS THIS A REAL THREAD" IS HOW THE WRITE AND READ LANES
    // LEARN TO DISAGREE ABOUT ONE ID. The ABSENT case is expressed here rather
    // than as an argument: an id nothing carries is a ROOM post, or a DROP.
    const at = (taskId?: string) =>
      ({ id: "m", seq: 1, kind: "message", metadata: taskId ? { taskId } : {} }) as unknown as ChannelMessage;
    expect(threadFacts(at(UUID), UUID).landed).toBe("thread");
    expect(threadFacts(at(LEGACY), LEGACY).landed).toBe("adhoc");
    expect(threadFacts(at(), undefined).landed).toBe("room");
    expect(threadFacts(at(), UUID).landed).toBe("dropped");
  });
});

// ── the post note ────────────────────────────────────────────────────
//
// ⚠ `unaddressedPostNote()` IS GONE (T12, 2026-09-02) — the "NOT ADDRESSED"
// paragraph and its threaded variant, spliced under every post that named
// nobody. The RULE it stated is true on every call, so it is stated once in
// `channel-doctrine.ts`; the post result carries `addressed=no`, plus `landed=`
// beside it. Each case below keeps both halves: the paragraph is out of the
// result, and the claim it made is still shipped.

/** An UNADDRESSED post's result line. ⚠ `addressed` is read off `toUserId`. */
const bare = async (channel: Record<string, unknown>, metadata: Record<string, unknown> = {}) =>
  (await opPost(postClient(channel, metadata), "general", "anyone free?")).content[0].text;

describe("addressed= / landed= — what the note became", () => {
  it("reports the addressing EITHER WAY, where the note was absent on success", async () => {
    // ⚠ INVERTED BY T12, AND IT IS THE POINT OF THE FIELD: the old note was
    // ABSENT on an addressed post, so "nothing said" carried the good news. A
    // field is present either way, so a reader can no longer confuse "addressed"
    // with "the narration was trimmed".
    expect(await bare({ isDirect: false })).toContain("addressed=no");
  });

  /**
   * ⚠ INVERTED 2026-08-18 (wiring plan Phase 3). This used to assert `null` for
   * a DIRECT channel, because `resolveDirectPeer` stamped the other member
   * server-side. That fallback is retired: an unaddressed DM post reaches
   * nobody's agent like any other, and staying quiet about it is exactly the
   * invisible-delivery failure this module exists to prevent.
   */
  it("WARNS in a direct channel too — nothing addresses a post for you now", async () => {
    expect(await bare({ isDirect: true })).toContain("addressed=no");
    // ⚠ The DM clause is what a caller told otherwise acts on, by leaving `to`
    // off and reaching nobody. It survives in the roster line and the doctrine.
    expect(rosterAddressingRule("general", 2)).toContain("a DIRECT (1:1) message channel included");
    expect(CHANNEL_DOCTRINE).toContain("in a room of two or of ten");
  });

  it("names the AUTHOR KIND as the reason, never the member count", async () => {
    // ⚠ THE LOOP BRAKE is what makes "your post woke nobody" safe against every
    // desktop build in the field, old or new — and it is keyed on the author
    // kind, never the size. A two-member channel is NOT a special case, and
    // claiming it is produces duplicate requests.
    const text = await bare({ isDirect: false });
    expect(text).toContain("addressed=no");
    expect(text).not.toContain("NOT ADDRESSED");
    expect(text).not.toContain("nobody was woken");
    expect(CHANNEL_DOCTRINE).toContain(
      "an AGENT-authored UNADDRESSED message starts nobody, in a room of two or of ten",
    );
  });

  it("does NOT claim silence for a post that landed on a first-class thread", async () => {
    // ⚠ `landed=` SITS BESIDE `addressed=` RATHER THAN COLLAPSING INTO IT, which
    // is the whole reason there are two fields: "nobody was woken" is FALSE for a
    // threaded post (`feedLiveSession` reads the tag before the addressing), and
    // the old remedy "re-post with `to=`" manufactured a duplicate request.
    const text = await bare({ isDirect: false }, { taskId: UUID });
    expect(text).toContain("landed=thread addressed=no");
    expect(text).not.toContain("re-post");
    expect(rosterAddressingRule("general", 2)).toContain(
      "routes the post into the session already working it",
    );
    // ⚠ RE-POINTED: the trailing "whatever its addressing says" was compressed out.
    expect(CHANNEL_DOCTRINE).toContain(
      "anything threaded into an exchange you are a party to is yours",
    );
  });

  it("keeps the two apart for a LEGACY tag, which routes to no session", async () => {
    // ⚠ Only a FIRST-CLASS (uuid) tag reaches a session, so the two cases may
    // never be narrated with one word: `adhoc` groups on a card and wakes nobody.
    const text = await bare({ isDirect: false }, { taskId: LEGACY });
    expect(text).toContain("landed=adhoc addressed=no");
    expect(text).not.toContain("landed=thread");
  });
});

describe("post — the addressing and the linkage on ONE line", () => {
  it("a threaded post never reads as nobody-was-woken", async () => {
    const text = await bare({ isDirect: false }, { taskId: UUID });
    expect(text).toContain("landed=thread addressed=no");
    expect(text).not.toContain("nobody was woken");
    expect(text).not.toContain("NO member's agent was triggered");
  });

  it("an unthreaded post reports both halves, and neither is a paragraph", async () => {
    // ⚠ HOW to address someone is the roster op's line and the doctrine's, not
    // this result's — it is the same sentence on every unaddressed post ever.
    const text = await bare({ isDirect: false });
    expect(text).toContain("landed=room addressed=no");
    expect(text.split("\n")).toHaveLength(1);
    expect(text).not.toContain('re-post it with to="<one member>"');
    expect(rosterAddressingRule("general", 3)).toContain('to="<their user id>"');
  });

  it("warns in a DIRECT channel too, and still names the thread it landed in", async () => {
    // ⚠ Inverted with the DM auto-address retirement (2026-08-18). A threaded
    // post reports the thread it landed in beside `addressed=no`, which is what
    // tells the caller to WAIT rather than re-post — the one remedy that would
    // double the request.
    const text = await bare({ isDirect: true }, { taskId: UUID });
    expect(text).toContain(`thread=${UUID} landed=thread addressed=no`);
    expect(text).not.toContain("Do NOT re-post it");
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
