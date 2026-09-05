import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESILIENCE_WINDOW_MS } from "@/shared/channels/caps";
import { SESSION_PROJECTION_FRESH_MS } from "../constants";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");

import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";
import {
  NOW,
  lastAddress,
  projection,
  recentAgentPosts,
  resolve,
  roomProjection,
  sessionRow,
} from "./service-wake-verdict-harness";

/**
 * **THE THREE RESILIENCE ARMS (B1)** — Samuel's ruling: narrowing the fan-out to
 * the addressed recipient must never let a forgotten `@` stall a conversation
 * (2026-09-02, v2 wave B slice B4).
 *
 * ⚠ **ITS OWN FILE BECAUSE `service-wake-verdict.test.ts` REACHED THE 500-LINE
 * CAP**, and the seam matches the one the source took: that file measures the
 * PRECEDENCE between explicit addressing and repair, this one measures the
 * three repair rules. ⚠ **THE HARNESS IS SHARED, NOT COPIED**
 * (`service-wake-verdict-harness.ts`, 2026-09-04): it was a near-verbatim
 * duplicate with a note saying it had to stay one, and a second way of driving
 * one resolver is how two suites come to disagree about what they are testing.
 *
 * ⚠ **EVERY CASE HERE IS PAIRED WITH ITS DEGENERATE ONE**, because each arm's
 * failure mode is silent: an arm that never fires looks exactly like a room
 * where nobody was addressed, and an arm that fires too eagerly looks exactly
 * like a delivery. Only the pair distinguishes them.
 */

beforeEach(() => {
  vi.clearAllMocks();
  projection();
  roomProjection();
  lastAddress(null);
  recentAgentPosts();
});

describe("RR1 — a thread reply with no `to` goes to the thread's other party", () => {
  it("resolves the OTHER party from the server's own thread stamps", async () => {
    const out = await resolve("what about the migration?", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
      taskTarget: "user-2",
    });
    expect(out).toMatchObject({
      verdict: "thread_peer",
      recipientUserIds: ["user-2"],
      recipientAgentIds: [],
      delivery: "delivered",
    });
  });

  it("…in EITHER direction — the author is whichever of the two they are", async () => {
    const out = await resolve("on it", {
      taskId: "task-1",
      taskCreatedBy: "user-2",
      taskTarget: "user-1",
    });
    expect(out.recipientUserIds).toEqual(["user-2"]);
  });

  it("costs NO extra read — the pair is already stamped in the metadata fold", async () => {
    await resolve("hi", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
      taskTarget: "user-2",
    });
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent)).not.toHaveBeenCalled();
  });

  it("DEGENERATE: an unaddressed thread has no other party — `thread`, not a guess", async () => {
    // `taskTarget` absent = the thread names nobody. There is no "other" to be
    // the other of, and inventing one would route a reply at the opener's
    // machine on the strength of a missing key.
    const out = await resolve("anyone?", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
    });
    expect(out).toMatchObject({ verdict: "thread", delivery: "idle" });
  });

  it("DEGENERATE: a LEGACY tag stamps no pair, so it stays `thread`", async () => {
    // A `task-<channelId>-<seq>` id resolves to no row, so fold 3 stamps none of
    // the four keys. RR1 answering nobody here is what keeps every installed
    // desktop's lifecycle echo costing one read instead of two.
    const out = await resolve("step done", { taskId: "task-chan-1-4" });
    expect(out).toMatchObject({ verdict: "thread", delivery: "idle" });
  });

  it("DEGENERATE: a STRIPPED legacy tag answers `none` and repairs NOTHING", async () => {
    // The poster is not in that exchange, so the tag was dropped. The post LOOKS
    // like a main-room post and is not one — the author was talking to a thread,
    // and repairing the address would put their words in front of whoever
    // happens to be in the room.
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("as discussed", {}, { threadTagStripped: true });
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("an explicit `to=` still wins — RR1 only fires when NOBODY was addressed", async () => {
    const out = await resolve("ping", {
      to_user_id: "user-3",
      taskId: "task-1",
      taskCreatedBy: "user-1",
      taskTarget: "user-2",
    });
    expect(out).toMatchObject({ verdict: "member", recipientUserIds: ["user-3"] });
  });
});

describe("RR2 — an unaddressed agent post in the main room goes back to whoever addressed it", () => {
  // 🔒 THE AUTHOR'S OWN LIVE SESSION. The stamp on `client_msg_id` is a CLAIM
  // (F-589) and the arm checks it against this projection before it selects a
  // recipient, so every case below must stand up an agent for the author to BE.
  beforeEach(() => {
    projection(sessionRow({ name: "k3v7d2mq" }));
  });

  it("🔒 REFUSES a stamp naming an agent the author does not run (F-589)", async () => {
    // ⚠ AGENT IDS ARE NOT SECRET — the desktop stamps `agent-<id>-<n>` and the
    // id is publicly readable off `channel_sessions.name`. Without the check,
    // any caller could claim a PEER's agent id and be handed the member who
    // last addressed that agent: their reply lands in front of somebody who was
    // mid-conversation with a different agent, in the wrong exchange. Same
    // class as the author-scoped idempotency probe, on the same field.
    lastAddress({ author_user_id: "user-9" });
    const out = await resolve("summary", {}, {
      authorKind: "agent",
      clientMsgId: "agent-peerpeer-4",
    });
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
    // …and it never even asks: the claim is refused before the read.
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent)).not.toHaveBeenCalled();
  });

  it("🔒 a STALE projection is not evidence either — the arm resolves on freshness only", async () => {
    // `isFresh`'s asymmetry, applied in the direction that matters here: this
    // arm RESOLVES a recipient, so it needs positive evidence. A stale row is
    // not evidence of presence and must not stand in for one.
    projection(
      sessionRow({
        name: "k3v7d2mq",
        updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS - 1).toISOString(),
      })
    );
    lastAddress({ author_user_id: "user-9" });
    const out = await resolve("summary", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-4",
    });
    expect(out.verdict).toBe("none");
  });

  it("resolves the AUTHOR of the last row addressed to this agent, inside the window", async () => {
    lastAddress({ author_user_id: "user-9", seq: 12 });
    const out = await resolve("here is the summary", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-4",
    });
    expect(out).toMatchObject({
      verdict: "reciprocal",
      recipientUserIds: ["user-9"],
      recipientAgentIds: [],
      delivery: "delivered",
    });
  });

  it("asks over the RESILIENCE WINDOW, read from `caps.ts` and never quoted", async () => {
    lastAddress({ author_user_id: "user-9" });
    await resolve("done", {}, { authorKind: "agent", clientMsgId: "agent-k3v7d2mq-4" });
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent).mock.calls).toEqual([
      ["chan-1", "k3v7d2mq", new Date(NOW - RESILIENCE_WINDOW_MS).toISOString()],
    ]);
  });

  it("resolves a MEMBER, never an agent — which is what keeps the same-account carve total", async () => {
    // 🔒 THE CROSS-ACCOUNT FENCE. "The party that addressed me" is an account,
    // whose own machine decides what runs. An arm that answered an AGENT id here
    // could aim an agent-authored wake at a PEER's agent through a rule the
    // author never wrote — exactly what Samuel's 2026-08-31 carve forbids.
    lastAddress({ author_user_id: "user-9" });
    const out = await resolve("reply", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-4",
    });
    expect(out.recipientAgentIds).toEqual([]);
  });

  it("DEGENERATE: nobody addressed it inside the window — `none`, a broadcast", async () => {
    lastAddress(null);
    const out = await resolve("thinking out loud", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-4",
    });
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
  });

  it("DEGENERATE: an agent post with NEITHER key cannot say which agent it is — no arm, no read", async () => {
    // `null` from `authorAgentIdOf` is "cannot say", never "some other agent".
    // Guessing would aim somebody's reply at the wrong conversation.
    const out = await resolve("no key", {}, { authorKind: "agent" });
    expect(out.verdict).toBe("none");
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent)).not.toHaveBeenCalled();
  });

  /**
   * **AN AGENT THAT SUPPLIED ITS OWN `client_msg_id` IS NOT ANONYMOUS**
   * (2026-09-04, follow-up 2 to the self-wake investigation).
   *
   * ⚠ **THE ARM KEYED ON THE STAMP ALONE, AND THE STAMP IS THE HALF AN AGENT CAN
   * OVERWRITE.** `main/session-outbound-tag.js › threadTagFor` deliberately never
   * replaces a `client_msg_id` an agent chose, so `parseAgentPostStamp` answered
   * `null` for every such post: no arm fired, `resilience` stayed null, and the
   * verdict's `unreachable` term fired instead. Rows #963, #965, #969 and #973
   * were stamped `delivery=unreachable` for a failure that never happened — and
   * `delivery=` is the one ack an orchestrator acts on.
   *
   * ⚠ **`metadata.session_id` IS THE STRONGER FACT, NOT A WEAKER FALLBACK.** It
   * is stripped from caller input and re-stamped from `X-Dopl-Session-Id`
   * (`service-writes-metadata.ts` fold 6b), so it cannot be posed — where the
   * stamp can. The F-589 own-scope check still runs over both.
   */
  describe("the author's identity comes off the session stamp too", () => {
    const OWN_SESSION = { session_id: "chan-1::k3v7d2mq" };

    it("fires for a post that supplied its own key — the #963 / #965 / #969 / #973 rows", async () => {
      lastAddress({ author_user_id: "user-9" });
      const out = await resolve("here is the answer", OWN_SESSION, {
        authorKind: "agent",
        clientMsgId: "reply-2",
      });
      expect(out).toMatchObject({
        verdict: "reciprocal",
        recipientUserIds: ["user-9"],
        delivery: "delivered",
      });
    });

    it("🔒 and therefore never reports `unreachable` for a delivery that happened", async () => {
      // ⚠ THE PRODUCTION SHAPE, EXACTLY. The body names a PEER's agent, which an
      // AGENT author cannot resolve (the carve), so `recipientAgentIds` is
      // `null` — and with no arm firing, the verdict's `unreachable` term is
      // what an orchestrator reads about a message that was delivered.
      lastAddress({ author_user_id: "user-9" });
      const out = await resolve("done — over to @agent-deynelz3", OWN_SESSION, {
        authorKind: "agent",
        clientMsgId: "my-own-idempotency-key",
      });
      // ⚠ `[]` HERE, NOT `null`: a repaired address is stored in the same two
      // columns as a written one, so the arm firing IS what replaces the null
      // the `unreachable` term keys on.
      expect(out.recipientAgentIds).toEqual([]);
      expect(out.delivery).not.toBe("unreachable");
      expect(out.delivery).toBe("delivered");
    });

    it("the STAMP still wins when both are present — it is the older form and some rows carry it alone", async () => {
      lastAddress({ author_user_id: "user-9" });
      await resolve("x", { session_id: "chan-1::m8q1zzzz" }, {
        authorKind: "agent",
        clientMsgId: "agent-k3v7d2mq-4",
      });
      expect(
        vi.mocked(repoMessages.findLastRoomAddressToAgent).mock.calls[0][1]
      ).toBe("k3v7d2mq");
    });

    it("🔒 F-589 STILL APPLIES to the session door — a key naming a peer's agent resolves nothing", async () => {
      // The projection holds only `k3v7d2mq`, so a session key claiming
      // `peerpeer` fails the own-scope check exactly as a forged stamp does.
      lastAddress({ author_user_id: "user-9" });
      const out = await resolve("summary", { session_id: "chan-1::peerpeer" }, {
        authorKind: "agent",
        clientMsgId: "reply-2",
      });
      expect(out).toMatchObject({ verdict: "none", delivery: "none" });
      expect(
        vi.mocked(repoMessages.findLastRoomAddressToAgent)
      ).not.toHaveBeenCalled();
    });

    it("a PERSON's cookie session_id starts no reciprocal arm — a person is not an agent", async () => {
      lastAddress({ author_user_id: "user-9" });
      const out = await resolve("morning", OWN_SESSION, { authorKind: "user" });
      expect(out.verdict).not.toBe("reciprocal");
    });
  });

  it("DEGENERATE: a MACHINE-level courtesy stamp is not an agent stamp", async () => {
    // `main/channel-post.js › postCourtesy` stamps `agent-<channelUUID>-<seq>`,
    // and the parser is ANCHORED for exactly this reason.
    const out = await resolve("courtesy", {}, {
      authorKind: "agent",
      clientMsgId: "agent-3f2b9c1e-4a5d-4c8e-9f01-2b3c4d5e6f70-1",
    });
    expect(out.verdict).toBe("none");
    expect(vi.mocked(repoMessages.findLastRoomAddressToAgent)).not.toHaveBeenCalled();
  });

  it("never reaches RR3 — an agent author does not get the room's default responder", async () => {
    // 🔒 THE ARMS ARE DISJOINT. RR3 exists so a PERSON is answered; handing an
    // agent's unaddressed thinking to the room's responder is the fan-out this
    // wave is deleting, wearing a new name.
    projection(sessionRow({ name: "m8q1zzzz" }));
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    lastAddress(null);
    const out = await resolve("musing", {}, {
      authorKind: "agent",
      clientMsgId: "agent-m8q1zzzz-2",
    });
    expect(out.verdict).toBe("none");
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });
});

describe("RR3 — an unaddressed human message is answered by one agent", () => {
  it("arm 1: the channel's configured DEFAULT RESPONDER wins", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz" })
    );
    const out = await resolve("can someone look at the build?", {}, {
      channel: { default_responder_agent_name: "agent-m8q1zzzz" },
    });
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["m8q1zzzz"],
      recipientUserIds: [],
      delivery: "woken",
    });
  });

  it("arm 1: the setting accepts the BARE handle too, through the one index", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz" })
    );
    const out = await resolve("hello", {}, {
      channel: { default_responder_agent_name: "m8q1zzzz" },
    });
    expect(out.recipientAgentIds).toEqual(["m8q1zzzz"]);
  });

  it("arm 1: a renamed responder resolves by its SLUG", async () => {
    roomProjection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Build Bot" })
    );
    const out = await resolve("hello", {}, {
      channel: { default_responder_agent_name: "build-bot" },
    });
    expect(out.recipientAgentIds).toEqual(["m8q1zzzz"]);
  });

  it("arm 2: exactly ONE live agent answers by itself — no setting needed", async () => {
    // ⚠ THIS IS WHY THE LLM TRIAGE LOOP GOES (B6). `tierFor` collapses to
    // `n === 1 ? SOLO : NONE`, and solo is computed here for free.
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
    });
  });

  it("arm 2: a responder that is NOT LIVE degrades into the sole agent", async () => {
    // The setting stores a handle and nothing enforces that it names a live
    // session — an FK to `agent_templates` would be a cross-visibility
    // reference. It degrades; it does not dangle.
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("morning", {}, {
      channel: { default_responder_agent_name: "agent-gone1234" },
    });
    expect(out.recipientAgentIds).toEqual(["k3v7d2mq"]);
  });

  it("arm 3: no live agent at all is `none` — an empty room is still an answer", async () => {
    const out = await resolve("morning");
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
    expect(out.reason).toBeNull();
  });

  it("a STALE room row is not a live agent — freshness gates the wake", async () => {
    roomProjection(
      sessionRow({
        name: "k3v7d2mq",
        updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS - 1).toISOString(),
      })
    );
    expect((await resolve("morning")).verdict).toBe("none");
  });

  it("does not fire for a non-`message` kind — a milestone repairs no address", async () => {
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("step two", {}, { kind: "task_progress" });
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("does not fire when the author addressed somebody", async () => {
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("look at this", { to_user_id: "user-2" });
    expect(out.verdict).toBe("member");
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });
});

describe("`to=@agent` — the union resolver's half of the verdict", () => {
  it("stores the agent the PARAMETER named, without reading the projection", async () => {
    // The resolution already happened at the door
    // (`service-writes-metadata-recipient.ts`); re-deriving it here would be a
    // second answer to a settled question.
    const out = await resolve("please take this", {}, { toAgentId: "k3v7d2mq" });
    expect(out).toMatchObject({
      verdict: "agent",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
    });
    expect(vi.mocked(repoSessions.listSessionStates)).not.toHaveBeenCalled();
  });

  it("OVERRIDES a handle in the prose — the parameter is what the caller MEANT", async () => {
    projection(sessionRow({ name: "m8q1zzzz" }));
    const out = await resolve("@agent-m8q1zzzz fyi", {}, { toAgentId: "k3v7d2mq" });
    expect(out.recipientAgentIds).toEqual(["k3v7d2mq"]);
  });

  it("suppresses every resilience arm — an addressed post needs no repair", async () => {
    roomProjection(sessionRow({ name: "m8q1zzzz" }));
    const out = await resolve("hi", {}, { toAgentId: "k3v7d2mq" });
    expect(out.verdict).toBe("agent");
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("is never `unreachable` — an unresolved `to` was refused at the door", async () => {
    const out = await resolve("go", {}, { toAgentId: "k3v7d2mq" });
    expect(out.delivery).toBe("woken");
  });
});
