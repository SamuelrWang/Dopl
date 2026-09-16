import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");
/**
 * ⚠ **PARTIAL, AND THAT IS LOAD-BEARING** (2026-09-07, items 10 and 11). RR3 grew a third input —
 * the AUTHOR's own `channel_members.unaddressed_responder`, read through `./repository` — and a
 * flat module mock would replace every other real read alongside it.
 *
 * ⚠ **AND IT IS NOT OPTIONAL, THOUGH THE SUITE WOULD "PASS" WITHOUT IT.**
 * `unaddressedResponderFor` SWALLOWS a read error and answers the default, so an UNMOCKED
 * repository reaches for a database that is not there — every case in this file timed out on that
 * read — and, had it failed fast instead, the cases would have gone green by way of the catch
 * block rather than by way of the setting. The harness seeds it in `beforeEach`.
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
 * **TWO LIVE AGENTS AND NO SETTING MUST NOT STALL** (2026-09-04, Samuel's B1
 * read the other way round).
 *
 * ⚠ **THIS ARM ANSWERED `none` UNTIL NOW, ON THE ARGUMENT THAT CHOOSING IS A
 * GUESS** — and the ruling in the same breath as the fan-out narrowing is that
 * a forgotten `@` must never stall a conversation. Row #966: a person wrote in
 * a room with two live agents and no default, the post stored `verdict=none`,
 * fed 0 of 2, and he re-sent it with a tag. Two live agents is the ORDINARY
 * shape of a multiplayer channel, so the "deliberately nobody" arm was the
 * common case wearing an edge case's clothes.
 *
 * ⚠ **AND IT IS NOT A GUESS, WHICH IS WHY IT IS SAYABLE.** "The one that spoke
 * here last" is the conversation's own answer to who is being talked to, and
 * the choice is stamped as a `reason` the read renders.
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

  /**
   * ⚠ **REPLACES "arm 3 reads the SESSION stamp too"** (2026-09-04). That case measured how the
   * old evidence — an agent's own POST — was attributed to an agent when the post carried its own
   * `client_msg_id`. Arm 3 no longer reads posts at all, so the case measured a path that is gone;
   * `authorAgentIdOf` still owns stamp-vs-session-key attribution and is still tested where RR2
   * uses it. What replaces it is the rule that took its place: **a row the SERVER aimed is not
   * evidence of what the author addressed**, without which the arm feeds on its own picks.
   */
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
   * 🔒 **AN AGENT-AUTHORED TAG IS NOT ITS OPERATOR'S ADDRESSING — THE FOURTH ROUND ON THIS BUG**
   * (F-704, 2026-09-15, Samuel: *"the last addressed agent must track the USER'S own most recent
   * addressing ONLY"*).
   *
   * ⚠ **THE TWO ROWS SHARE AN `author_user_id` AND THAT IS THE DEFECT ITSELF.**
   * `service-writes.ts` writes `author_user_id: ctx.userId` on every row, an agent's included, so
   * arm 3's author filter — correct on the identity axis — silently swept in the author's OWN
   * agents. An orchestrator handing work to a worker re-pointed its operator's default responder.
   * ⚠ **`metadata` IS EMPTY ON THE AGENT ROW, DELIBERATELY.** The agent typed its own tag, so the
   * server stamped no `wake_reason` and the existing "the server's own picks are not evidence"
   * guard (`isAuthorTypedAgentTag`) answers `true` for it. A fixture with a `wake_reason` would
   * pass against the broken code and prove nothing.
   * ⚠ **THE AGENT ROW IS NEWEST (`seq` 43 over 42)** — it must lose to an older HUMAN tag, or the
   * test passes on ordering luck rather than on the predicate.
   *
   * This is channel `bb0f57db`, exactly: Samuel addresses Prime (`k3v7d2mq` here), Prime posts to
   * a worker (`m8q1zzzz`), and Samuel's next untagged message must still reach Prime. Three
   * earlier fixes each changed WHICH ROWS the arm selects (`c0794ed3` fed it "who posted last";
   * its fix swapped `author_kind` FOR `author_user_id` instead of intersecting them; `f5035e66`
   * removed the window, making the stomp permanent rather than self-healing) and none added the
   * predicate this pins. If arm 3 ever reads an agent-authored row as evidence again, this goes
   * red.
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

  // ⚠ TITLE CORRECTED 2026-09-06: there is no window on this arm any more, and the condition was
  // never "inside" one — arm 4 answers when this author has tagged NOBODY who is still live.
  it("arm 4: this author has tagged nobody → the most recently LAUNCHED", async () => {
    twoLive();
    recentAgentPosts();
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["m8q1zzzz"],
      reason: "most recently launched",
    });
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

  it("a stale agent the author tagged, no longer live, cannot be the answer", async () => {
    twoLive();
    // ⚠ THE ROW IS THE AUTHOR'S OWN TAG SINCE 2026-09-04 — `recipient_agent_ids`, not a post
    // stamp. The agent it names has since ended.
    recentAgentPosts({ seq: 42, recipient_agent_ids: ["deadbeef"] });
    // The recency list names an agent the room no longer holds, so arm 3 skips
    // it and arm 4 answers — never a wake aimed at a session that is gone.
    expect((await resolve("morning")).recipientAgentIds).toEqual(["m8q1zzzz"]);
  });
});
});

/**
 * **A HANDLE THE SERVER COULD NOT RESOLVE IS NOT A FORGOTTEN `@`** (2026-09-14, Samuel's
 * `@prime` report: *"I just addressed a message to a new agent I created, but for some reason
 * it's set to send to the most recent agent even though I tagged a completely different
 * agent."*).
 *
 * ⚠ **THE INCIDENT, AS THE ROW RECORDS IT.** Channel `dopl`, seq 1698, 2026-09-14 18:28:32Z:
 * `body='@prime hey'`, `recipient_agent_ids=['y1uun32v']`, `wake_verdict='responder'`,
 * `metadata.wake_reason='only agent'`, `delivery='woken'`. `y1uun32v` is the room's OTHER agent
 * ("coder for Overview usage polish"); `prime` had been spawned nine seconds earlier and its
 * `channel_sessions` row had not been pushed yet, so the index held no handle for it.
 *
 * ⚠ **WHAT WENT WRONG IS A CONFLATION, NOT A LOOKUP.** `resolveAgentRecipients` answered `null`
 * correctly — "handles were named and I cannot say whose they are" — and `resolveWakeVerdict`
 * read that as "addressed nobody", which is the ONE precondition the resilience arms have
 * (INVARIANTS §5 › THE RESILIENCE ARMS: *"reached ONLY when the author addressed nobody"*). RR3
 * then repaired an address that was never missing.
 *
 * ⚠ **THESE CASES PIN THE PRECONDITION, NOT THE ARM.** RR3's own picking rules are measured
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
   * ⚠ **A HANDLE THAT RESOLVED TO ONLY THE AUTHOR IS STILL AN UNADDRESSED POST**, and that is
   * the distinction `resolveAgentRecipients` draws between `[]` and `null` — the one this gate
   * must not flatten. `service-wake-verdict.ts`'s self-address drop says so in as many words:
   * *"the prose is read, and the resilience arms get their turn"*.
   */
  /**
   * 🔒 **THE GATE IS ON RR3 ALONE, AND THIS IS THE CASE THAT KEEPS IT THERE.**
   *
   * ⚠ **AN AGENT AUTHOR'S `null` IS A SCOPE REFUSAL, NOT AN UNKNOWN NAME.** Its door is
   * own-scoped by the same-account carve, so a body naming a PEER's agent answers `null`
   * meaning *"I may not resolve that"* — where a HUMAN's door reads the whole room and `null`
   * really does mean nobody here answers to it. The two are the same value and different
   * claims.
   *
   * ⚠ **AND RR2 REPAIRS A MEMBER, WHICH TAKES NOTHING FROM THE HANDLE IN THE PROSE** — that
   * member's side decides what runs. Only RR3 answers with an AGENT, i.e. only RR3 can
   * substitute one agent for another, which is the harm the gate exists for. Widening the gate
   * to `repairable` re-stamps rows #963 / #965 / #969 / #973 `unreachable` for deliveries that
   * happened; `service-wake-verdict-resilience.test.ts › never reports 'unreachable' for a
   * delivery that happened` is the other end of this wire, and it went red when the gate sat
   * there for the first time.
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
