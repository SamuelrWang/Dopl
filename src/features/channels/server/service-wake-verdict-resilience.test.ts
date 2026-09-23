import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_PROJECTION_FRESH_MS } from "../constants";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");
/** Partial: RR3 reads the author's `unaddressed_responder` through `./repository`, and the real
 *  `unaddressedResponderFor` swallows a read error into the default — unmocked, cases would time out or
 *  pass by the catch rather than the setting. The harness seeds it in `beforeEach`. */
vi.mock("./repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository")>()),
  findUnaddressedResponder: vi.fn(),
}));

import * as repoSessions from "./repository-sessions";
import {
  NOW,
  projection,
  recentAgentPosts,
  resolve,
  roomProjection,
  sessionRow,
  unaddressedResponder,
} from "./service-wake-verdict-harness";

/** The resilience arms: narrowing fan-out to the addressed recipient must never let a forgotten `@`
 *  stall a conversation. Each arm is paired with its degenerate case, since a silent arm and an eager
 *  one both look like ordinary outcomes. Driven through `service-wake-verdict-harness.ts`. */

beforeEach(() => {
  vi.clearAllMocks();
  projection();
  roomProjection();
  recentAgentPosts();
  unaddressedResponder();
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
  });

  it("DEGENERATE: an unaddressed thread has no other party — `thread`, not a guess", async () => {
    // `taskTarget` absent: the thread names nobody, so there is no other party to route to.
    const out = await resolve("anyone?", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
    });
    expect(out).toMatchObject({ verdict: "thread", delivery: "idle" });
  });

  it("DEGENERATE: a LEGACY tag stamps no pair, so it stays `thread`", async () => {
    // A legacy `task-<channelId>-<seq>` id resolves to no row, so no pair is stamped.
    const out = await resolve("step done", { taskId: "task-chan-1-4" });
    expect(out).toMatchObject({ verdict: "thread", delivery: "idle" });
  });

  it("DEGENERATE: a STRIPPED legacy tag answers `none` and repairs NOTHING", async () => {
    // The author was talking to a thread; repairing the address would show their words to the room.
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

describe("RR2 IS DELETED — an unaddressed AGENT post reaches nobody", () => {
  // Agents are woken only when addressed: an unaddressed agent post reaches nobody.
  beforeEach(() => {
    projection(sessionRow({ name: "k3v7d2mq" }));
  });

  it("lands on `none` — nobody, no repair, and NO READ paid for one", async () => {
    const out = await resolve("thinking out loud", {}, {
      authorKind: "agent",
      clientMsgId: "agent-k3v7d2mq-1",
    });
    expect(out).toMatchObject({
      verdict: "none",
      recipientUserIds: [],
      recipientAgentIds: [],
      delivery: "none",
    });
  });

  it("never reaches RR3 — an agent author does not get the room's default responder", async () => {
    // RR3 exists so a person is answered; an agent's unaddressed post gets no default responder.
    projection(sessionRow({ name: "m8q1zzzz" }));
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("musing", {}, {
      authorKind: "agent",
      clientMsgId: "agent-m8q1zzzz-2",
    });
    expect(out.verdict).toBe("none");
    expect(vi.mocked(repoSessions.listChannelSessionStates)).not.toHaveBeenCalled();
  });

  it("a THREADED agent post is UNTOUCHED — RR1 is an address, not a repair", async () => {
    // A thread has exactly two parties, so `thread_peer` holds for either author kind.
    const out = await resolve("here is the diff", {
      taskId: "task-1",
      taskCreatedBy: "user-1",
      taskTarget: "user-2",
    }, { authorKind: "agent", clientMsgId: "agent-k3v7d2mq-3" });
    expect(out).toMatchObject({ verdict: "thread_peer", recipientUserIds: ["user-2"] });
  });
});

describe("RR3 — an unaddressed human message is answered by one agent", () => {
  // The unaddressed responder is the asking person's own `channel_members.unaddressed_responder`, read by
  // `unaddressedResponderFor`; there is no room-wide pin.

  it("arm 2: exactly ONE live agent answers by itself — no setting needed", async () => {
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
    });
  });

  it("arm 3: no live agent at all is `none` — an empty room is still an answer", async () => {
    const out = await resolve("morning");
    expect(out).toMatchObject({ verdict: "none", delivery: "none" });
    expect(out.reason).toBeNull();
  });

  it("THE ASYMMETRY: a STALE but PRESENT room row IS a live agent and IS woken", async () => {
    // Paired with the empty-room case: stale must resolve and absent must not. `updated_at` is
    // written on state change only, so age measures silence; absence is the full-set replace.
    roomProjection(
      sessionRow({
        name: "k3v7d2mq",
        updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS - 1).toISOString(),
      })
    );
    expect(await resolve("morning")).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
    });
  });

  it("a room row with NO agent id is still dropped — that was never a freshness rule", async () => {
    // `name` is the agent id; a row with none could not be woken.
    roomProjection(sessionRow({ name: "" }));
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
    // Resolved at the door (`service-writes-metadata-recipient.ts`); not re-derived here.
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
