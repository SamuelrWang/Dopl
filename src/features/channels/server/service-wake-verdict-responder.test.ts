import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");
/**
 * ⚠ **PARTIAL, AND NOT OPTIONAL** (2026-09-07, items 10/11). RR3 reads the AUTHOR's own
 * `channel_members.unaddressed_responder` through `./repository`; a flat mock would replace every
 * other real read with it, and NO mock makes each case go green through
 * `unaddressedResponderFor`'s catch rather than through the setting. Seeded in `beforeEach`.
 */
vi.mock("./repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository")>()),
  findUnaddressedResponder: vi.fn(),
}));

import * as repoMessages from "./repository-messages";
import {
  NOW,
  lastAddress,
  projection,
  recentAgentPosts,
  resolve,
  unaddressedResponder,
  roomProjection,
  sessionRow,
} from "./service-wake-verdict-harness";

/**
 * **RR3 WHEN THE ROOM HOLDS MORE THAN ONE LIVE AGENT** (2026-09-04).
 *
 * ⚠ **ITS OWN FILE BECAUSE `service-wake-verdict-resilience.test.ts` REACHED THE
 * 500-LINE CAP**, and the seam is the one the arms take: that file measures RR1,
 * RR2 and the arms that need no CHOICE (a configured responder, a room with one
 * agent), this one measures the two that pick — and the pick is the part with a
 * ruling behind it.
 */

beforeEach(() => {
  vi.clearAllMocks();
  projection();
  roomProjection();
  lastAddress(null);
  recentAgentPosts();
  unaddressedResponder();
});

describe("RR3 — several live agents, and a person who named nobody", () => {
/**
 * **TWO LIVE AGENTS AND NO SETTING MUST NOT STALL** (2026-09-04, Samuel's B1: a forgotten `@`
 * must never stall a conversation). "The one this author tagged last" is the conversation's own
 * answer to who is being talked to, and the pick is stamped as a `reason` the read renders.
 */
describe("arm 3 / arm 4 — several live agents still get an answer", () => {
  function twoLive(): void {
    roomProjection(
      sessionRow({
        id: "s-1",
        name: "k3v7d2mq",
        started_at: new Date(NOW - 60_000).toISOString(),
      }),
      sessionRow({
        id: "s-2",
        name: "m8q1zzzz",
        started_at: new Date(NOW - 10_000).toISOString(),
      })
    );
  }

  it("arm 3: routes to the agent THIS AUTHOR tagged most recently — the #966 row", async () => {
    twoLive();
    // ⚠ THE EVIDENCE CHANGED ON 2026-09-04 (Samuel): it was "who posted here last", which let one
    // agent tagging another move every member's default responder. It is the author's OWN tags now.
    recentAgentPosts(
      { seq: 42, recipient_agent_ids: ["k3v7d2mq"] },
      { seq: 41, recipient_agent_ids: ["m8q1zzzz"] }
    );
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
      reason: "most recent",
    });
  });

  /** 🔒 **A ROW THE SERVER AIMED IS NOT EVIDENCE OF WHAT THE AUTHOR ADDRESSED** (2026-09-04) —
   *  without it the arm feeds on its own picks. */
  it("🔒 a row the SERVER aimed is not evidence — only the author's own tag counts", async () => {
    twoLive();
    recentAgentPosts(
      // Newest, but the server chose it: `wake_reason` is present, so it must be ignored.
      {
        seq: 42,
        recipient_agent_ids: ["k3v7d2mq"],
        metadata: { wake_reason: "most recent" },
      },
      { seq: 41, recipient_agent_ids: ["m8q1zzzz"] }
    );
    expect((await resolve("morning")).recipientAgentIds).toEqual(["m8q1zzzz"]);
  });

  /**
   * 🔒 **AUTHOR STICKINESS HAS NO CLOCK** (Samuel, 2026-09-06) — the case that flips the one this
   * file pinned by omission.
   *
   * ⚠ **THE BUG WAS THAT THE RULE HUNG ON THE WRONG CLOCK, NOT THAT IT WAS WRONG.** The walk and
   * the read under it were both bounded by `RESILIENCE_WINDOW_MS`, so at fifteen minutes and one
   * second the author's own tag stopped being evidence and arm 4 answered instead — the room
   * changing voice on a timer, with nothing the operator did. **The tag below is TWO HOURS OLD and
   * must still win**, over `m8q1zzzz`, which is the agent arm 4 would name (it launched last, per
   * `twoLive`). If a window ever comes back, this is the case that goes red.
   */
  it("🔒 a TWO-HOUR-OLD tag still resolves — the author rule has no window", async () => {
    twoLive();
    recentAgentPosts({
      seq: 42,
      created_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
      recipient_agent_ids: ["k3v7d2mq"],
    });
    const out = await resolve("morning");
    expect(out).toMatchObject({
      recipientAgentIds: ["k3v7d2mq"],
      reason: "most recent",
    });
  });

  /**
   * 🔒 **AND A NEW TAG SUPERSEDES AN OLD ONE — the other half of "no window"**. Without this,
   * removing the clock could be read as "the first agent you ever tagged is the default forever".
   * The ruling is *last-addressed*, so the newer row wins on `seq` however old either one is.
   */
  it("🔒 the NEWER tag wins over an older one, both far outside the old window", async () => {
    twoLive();
    recentAgentPosts(
      {
        seq: 41,
        created_at: new Date(NOW - 5 * 60 * 60_000).toISOString(),
        recipient_agent_ids: ["k3v7d2mq"],
      },
      {
        seq: 42,
        created_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
        recipient_agent_ids: ["m8q1zzzz"],
      }
    );
    expect((await resolve("morning")).recipientAgentIds).toEqual(["m8q1zzzz"]);
  });

  /**
   * 🔒 **AN AGENT-AUTHORED TAG IS NOT ITS OPERATOR'S ADDRESSING** (F-704, 2026-09-15, Samuel:
   * *"the last addressed agent must track the USER'S own most recent addressing ONLY"*).
   *
   * ⚠ **THE TWO ROWS SHARE AN `author_user_id` AND THAT IS THE DEFECT ITSELF** —
   * `service-writes.ts` writes `ctx.userId` on every row, an agent's included, so an author
   * filter that is correct on the identity axis sweeps in the author's OWN agents.
   * ⚠ **`metadata` IS EMPTY ON THE AGENT ROW, DELIBERATELY**: the agent typed its own tag, so
   * `isAuthorTypedAgentTag` answers `true` for it and a `wake_reason` fixture would pass against
   * the broken code. ⚠ **THE AGENT ROW IS NEWEST** (`seq` 43 over 42), or the case passes on
   * ordering luck rather than on the predicate.
   */
  it("🔒 my own agent's tag never becomes my last-addressed — the bb0f57db repro", async () => {
    twoLive();
    recentAgentPosts(
      {
        // Samuel → Prime. The human's own act, and older.
        seq: 42,
        author_kind: "user",
        recipient_agent_ids: ["k3v7d2mq"],
      },
      {
        // Prime → a worker, under Samuel's user id, tag typed by the agent.
        seq: 43,
        author_kind: "agent",
        recipient_agent_ids: ["m8q1zzzz"],
        metadata: {},
      }
    );
    const out = await resolve("what is left to do?");
    expect(out).toMatchObject({
      recipientAgentIds: ["k3v7d2mq"],
      reason: "most recent",
    });
  });

  /**
   * 🔒 **"…OR THAT AGENT ENDS" — the ruling's own exit, and the only one.** The newest tag names an
   * agent that has since ended, so the pick falls to the NEXT-MOST-RECENT TAG rather than to arm 4:
   * stickiness ends with the session, not with a stopwatch. Both rows are hours old, which is what
   * makes this the aged sibling of the stale-agent case below.
   */
  it("🔒 an ENDED agent is skipped and the next TAG wins — not arm 4", async () => {
    twoLive();
    recentAgentPosts(
      {
        seq: 41,
        created_at: new Date(NOW - 3 * 60 * 60_000).toISOString(),
        recipient_agent_ids: ["k3v7d2mq"],
      },
      {
        seq: 42,
        created_at: new Date(NOW - 60 * 60_000).toISOString(),
        // Tagged, then ended: never in the room projection `twoLive` seeds.
        recipient_agent_ids: ["deadbeef"],
      }
    );
    const out = await resolve("morning");
    expect(out).toMatchObject({
      recipientAgentIds: ["k3v7d2mq"],
      reason: "most recent",
    });
  });

  /**
   * 🔒 **THE READ IS BOUNDED BY THE PAGE, NOT BY A TIME** (2026-09-06). The rule above cannot be
   * unbounded if the query underneath it still drops everything older than fifteen minutes — that
   * was the bug's read half — so this pins the ARGUMENTS: channel and author, and nothing else.
   * `repository-messages-recent.ts › RECENT_AGENT_POSTS_LIMIT` is the bound that remains, asserted
   * from its own module rather than re-typed here.
   */
  it("🔒 arm 3's read is passed NO `since` bound — channel and author only", async () => {
    twoLive();
    recentAgentPosts({ seq: 42, recipient_agent_ids: ["k3v7d2mq"] });
    await resolve("morning");
    expect(vi.mocked(repoMessages.listRecentRoomTagsBy).mock.calls).toEqual([
      ["chan-1", "user-1"],
    ]);
  });

  /**
   * 🔒 **TAGGED NOBODY WHO IS STILL LIVE → NOBODY** (F-705, 2026-09-15, Samuel: *"when the
   * last-tagged agent has ENDED, the fallback answers NOBODY — auto-address resets to
   * none-selected and stays there until the user tags someone new"*).
   *
   * ⚠ **`m8q1zzzz` IS STILL THE NEWEST LAUNCH IN `twoLive`, WHICH IS WHAT MAKES THIS MEASURE THE
   * CHANGE** — if any name comes back here, the launch-order guess is back.
   * ⚠ **IT IS A DELIBERATE EDIT TO B1** ("a forgotten `@` must never stall", 2026-09-04): a guess
   * that wanders is worse than a stall, because the operator cannot tell a wrong recipient from a
   * right one until the wrong agent answers. B1 still holds in arms 2 and 3.
   */
  it("🔒 arm 4 is NOBODY — tagged no live agent, so nothing is woken", async () => {
    twoLive();
    recentAgentPosts();
    const out = await resolve("morning");
    expect(out.verdict).toBe("none");
    expect(out.recipientAgentIds ?? []).toEqual([]);
    // ⚠ `null`, not a reason word: nothing was picked, so there is nothing to explain, and
    // `service-writes.ts` stamps no `wake_reason` onto the row at all.
    expect(out.reason ?? null).toBeNull();
  });

  // 🔒 "the CONFIGURED responder still wins — an operator is never second-guessed by recency"
  // STOOD HERE AND IS DELETED (2026-09-06, Samuel's ruling on items 10/11). It pinned the
  // channel's room-wide `default_responder_agent_name` beating the recency arm below it. There is
  // no configured handle any more and no `reason: "default"`: the room-wide pin is replaced by the
  // ASKING PERSON's own setting, which is two-valued and either lets these arms run or turns them
  // all off (`'none'`), rather than naming an agent that outranks them.

  it("🔒 the arm-3 READ IS LAZY — a settled room pays for no round trip", async () => {
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("morning");
    expect(out.reason).toBe("only agent");
    expect(
      vi.mocked(repoMessages.listRecentRoomTagsBy)
    ).not.toHaveBeenCalled();
  });

  /**
   * 🔒 **THE TAGGED AGENT HAS ENDED → NOBODY, AND THAT IS THE RULING'S OWN SENTENCE.**
   *
   * ⚠ **WHAT THIS CASE GUARDS HAS NOT CHANGED: `deadbeef` IS NOT WOKEN.** A wake aimed at a
   * session that is gone is the defect it was written for, and that assertion is kept explicitly
   * below rather than left implied by the new one.
   * ⚠ **WHAT CHANGED IS THE ARM UNDER IT** (2026-09-15, F-705): it expected `["m8q1zzzz"]` —
   * the newest launch — and the answer is NOBODY now. This is the exact shape Samuel described:
   * the agent he last tagged has ended, so auto-address resets to none-selected and waits for
   * him to tag somebody new rather than quietly choosing a stranger.
   */
  it("🔒 a stale agent the author tagged, no longer live → nobody, and never it", async () => {
    twoLive();
    // ⚠ THE ROW IS THE AUTHOR'S OWN TAG SINCE 2026-09-04 — `recipient_agent_ids`, not a post
    // stamp. The agent it names has since ended.
    recentAgentPosts({ seq: 42, recipient_agent_ids: ["deadbeef"] });
    const out = await resolve("morning");
    expect(out.recipientAgentIds ?? []).not.toContain("deadbeef");
    expect(out.recipientAgentIds ?? []).toEqual([]);
    expect(out.verdict).toBe("none");
  });
});
});

/**
 * **A HANDLE THE SERVER COULD NOT RESOLVE IS NOT A FORGOTTEN `@`** (2026-09-14, Samuel's
 * `@prime` report: *"I just addressed a message to a new agent I created, but for some reason
 * it's set to send to the most recent agent even though I tagged a completely different
 * agent."*).
 *
 * ⚠ **THE DEFECT IS A CONFLATION, NOT A LOOKUP.** `resolveAgentRecipients` answers `null`
 * correctly — "handles were named and I cannot say whose they are" — and `resolveWakeVerdict`
 * read that as "addressed nobody", which is the ONE precondition the resilience arms have
 * (INVARIANTS §5 › THE RESILIENCE ARMS). RR3 then repaired an address that was never missing.
 *
 * ⚠ **THESE CASES PIN THE PRECONDITION, NOT THE ARM** — RR3's own picking rules are measured
 * above and are unchanged; what is measured here is that the arm is never ASKED.
 */
describe("🔒 an unresolved handle blocks the repair — it is not an unaddressed post", () => {
  /** The room as it stood: ONE pushed session, which is what made `reason: "only agent"`
   *  available to fire. A second live agent would have produced the same defect via arm 3/4. */
  function onlyTheOtherAgent(): void {
    roomProjection(sessionRow({ name: "y1uun32v", display_name: "coder for Overview usage polish" }));
  }

  it("🔒 `@prime hey` does not become a wake for the room's only other agent", async () => {
    onlyTheOtherAgent();
    const out = await resolve("@prime hey");
    // ⚠ THE WHOLE REGRESSION IN ONE FIELD: this was `['y1uun32v']`.
    expect(out.recipientAgentIds).toBeNull();
    expect(out.verdict).toBe("none");
    // ⚠ AND THE REASON MUST BE ABSENT, because `metadata.wake_reason` is the server saying "I
    // chose this one, and here is why" — a sentence it has no business writing about a post
    // whose author named somebody.
    expect(out.reason).toBeNull();
  });

  /**
   * ⚠ **`unreachable` IS THE POINT, NOT A CONSOLATION.** G15's silent-miss rule: a name that
   * reached nobody must SAY so. The alternative this replaces was a DIFFERENT name reaching
   * somebody quietly, which no surface could have told the author about — the composer's own
   * line printed `→ @coder-for-overview-usage-polish` and looked deliberate.
   * ⚠ AND `recipientAgentIds: null` above is the other half: it hands the question back to the
   * machine, which is the only place a not-yet-pushed session row is knowable.
   */
  it("🔒 it is reported `unreachable`, so the miss is visible rather than silent", async () => {
    onlyTheOtherAgent();
    expect((await resolve("@prime hey")).delivery).toBe("unreachable");
  });

  /**
   * ⚠ **TWO LIVE AGENTS, DELIBERATELY** — with one, arm 2 answers before arm 3 issues its read
   * and the assertion below would hold for the wrong reason (the arm-3 read is LAZY; the case
   * above this describe pins that). Two is also the shape that makes the defect general: the
   * incident room happened to hold one agent, but `most recent` / `most recently launched` would
   * have re-aimed `@prime` just as confidently.
   */
  it("🔒 RR3 is never even ASKED — no responder read on a post that named somebody", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "y1uun32v", started_at: new Date(NOW - 60_000).toISOString() }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", started_at: new Date(NOW - 10_000).toISOString() })
    );
    const out = await resolve("@prime hey");
    expect(vi.mocked(repoMessages.listRecentRoomTagsBy)).not.toHaveBeenCalled();
    expect(out.recipientAgentIds).toBeNull();
  });

  /**
   * 🔒 **A MEMBER'S HANDLE IS NOT AN UNRESOLVED AGENT HANDLE** (2026-09-15).
   *
   * ⚠ **THE GATE READ `@samuel` AS "the author named an agent I cannot place".** Members
   * outrank agents on this door since 2026-09-07, so a roster handle is deliberately absent
   * from the agent index — and `resolveAgentRecipients` answered `null` for it, which
   * `namedButUnresolved` reads as a typed handle. RR3 was then never asked and the post was
   * stamped `unreachable`: *"@samuel can you look at this"* woke nobody and reported a miss
   * that had not happened. The member half of that same body is resolved one fold earlier by
   * `service-writes-metadata-mentions.ts › resolveBodyMentions`, off the same roster read.
   * ⚠ **`reservedHandles` IS WHAT THE WRITE PATH ACTUALLY PASSES** (`service-writes.ts` hands
   * down `PostMetadataResult.memberHandles`), so the fixture below is the production shape.
   */
  it("🔒 `@samuel …` still gets the repair — a member handle is a resolved address", async () => {
    onlyTheOtherAgent();
    const out = await resolve("@samuel can you look at this", {}, {
      reservedHandles: ["samuel", "samuel-wang"],
    });
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["y1uun32v"],
      delivery: "woken",
      reason: "only agent",
    });
  });

  /**
   * 🔒 **AN EMAIL ADDRESS IS NOT AN `@`-TAG** (F-706, 2026-09-16). `mentionTokensOf` needed no
   * word boundary before the `@`, so `sam@example.com` yielded the handle `example.com` — which
   * nothing answers to — and `namedButUnresolved` read that as "the author named somebody".
   * **An ordinary email address in a message turned the repair off and stored `unreachable`.**
   * The fix is the tokenizer (`lib/mentions.ts › MENTION_TOKEN_RE`, pinned across all three trees
   * by `lib/mentions-boundary.test.ts`); this is the end of that wire.
   */
  it("🔒 a body carrying an EMAIL ADDRESS still gets the repair", async () => {
    onlyTheOtherAgent();
    const out = await resolve("ping me at sam@example.com when it lands");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["y1uun32v"],
      delivery: "woken",
    });
  });

  /**
   * 🔒 **`@here` IS A TYPED TAG THAT REACHES NOBODY, AND SAYING SO IS THE POINT** — this case
   * pins the behaviour DELIBERATELY rather than by omission (F-706, 2026-09-16).
   *
   * ⚠ **THE SERVER CANNOT TELL `@here` FROM `@prime`, AND NEITHER COULD ANY RULE WE COULD
   * WRITE.** `prime` was a real agent whose `channel_sessions` row had not been pushed yet;
   * `here` is a word. Both are well-formed slugs, because `agent-names.js › sanitizeName` lets an
   * operator name an agent `here`. A shape test that separated them would be a third spelling of
   * the handle grammar, which `service-wake-verdict.ts`'s own header forbids (F-266).
   * ⚠ **SO THE GATE STANDS, AND IT IS THE RIGHT ANSWER FOR A TYPED TOKEN**: the author wrote an
   * address, nothing in the room answers to it, and G15 says a name that reached nobody SAYS so
   * rather than a different name reaching somebody quietly. What was wrong was never this — it
   * was the tokenizer INVENTING a tag the author never typed.
   */
  it("🔒 `@here` still reports unreachable — a typed token that names nobody", async () => {
    onlyTheOtherAgent();
    const out = await resolve("ship it @here");
    expect(out.recipientAgentIds).toBeNull();
    expect(out.delivery).toBe("unreachable");
  });

  /** ⚠ **AND THE `@prime` GATE IS UNCHANGED BESIDE IT** — a handle the room's MEMBER namespace
   *  does NOT hold is still the author naming somebody this server cannot place. */
  it("🔒 a member roster does not weaken the `@prime` gate", async () => {
    onlyTheOtherAgent();
    const out = await resolve("@prime hey", {}, { reservedHandles: ["samuel"] });
    expect(out.recipientAgentIds).toBeNull();
    expect(out.delivery).toBe("unreachable");
  });

  /**
   * ⚠ **THE REPAIR ITSELF IS UNTOUCHED, AND THIS IS THE CASE THAT PROVES THE GATE IS NARROW.**
   * B1 is Samuel's standing ruling — a forgotten `@` must never stall a conversation — and a
   * fix that bought the `@prime` case by turning RR3 off would be reversing it silently, which
   * is the defect class this whole wave exists to remove. Same room, same single agent, a body
   * with no handle in it: still woken.
   */
  it("🔒 a body that names NOBODY still gets the repair — B1 is not reversed", async () => {
    onlyTheOtherAgent();
    const out = await resolve("hey");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["y1uun32v"],
      delivery: "woken",
      reason: "only agent",
    });
  });

  /**
   * 🔒 **THE GATE IS ON RR3 ALONE, AND THIS IS THE CASE THAT KEEPS IT THERE.** An AGENT author's
   * `null` is a SCOPE REFUSAL (*"I may not resolve that"*), not an unknown name — the same value
   * and a different claim from a HUMAN's, whose door reads the whole room. RR2 repairs a MEMBER,
   * which takes nothing from the handle in the prose; only RR3 can substitute one agent for
   * another. Widening the gate to `repairable` re-stamps #963/#965/#969/#973 `unreachable` for
   * deliveries that happened (`service-wake-verdict-resilience.test.ts › never reports
   * 'unreachable' for a delivery that happened` is the other end of this wire).
   */
  it("🔒 an AGENT naming a PEER's agent still gets RR2 — the gate is not on `repairable`", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    lastAddress({ author_user_id: "user-9" });
    const out = await resolve(
      "done — over to @agent-deynelz3",
      { session_id: "chan-1::k3v7d2mq" },
      { authorKind: "agent", clientMsgId: "my-own-idempotency-key" }
    );
    expect(out).toMatchObject({ verdict: "reciprocal", delivery: "delivered" });
    expect(out.recipientAgentIds).toEqual([]);
  });

  it("🔒 a self-tag resolves to `[]`, which still reaches the repair", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "y1uun32v" })
    );
    projection(sessionRow({ id: "s-1", name: "k3v7d2mq" }));
    const out = await resolve(
      "@agent-k3v7d2mq noted",
      { session_id: "chan-1:task-1:k3v7d2mq" },
      { authorKind: "agent" }
    );
    // The body named only the author, so nothing was addressed — RR2's lane, not `unreachable`.
    expect(out.delivery).not.toBe("unreachable");
  });
});
