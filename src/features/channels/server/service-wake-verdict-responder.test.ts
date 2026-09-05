import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");

import * as repoMessages from "./repository-messages";
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

  it("arm 3: routes to the agent that POSTED here most recently — the #966 row", async () => {
    twoLive();
    recentAgentPosts(
      { seq: 42, client_msg_id: "agent-k3v7d2mq-3" },
      { seq: 41, client_msg_id: "agent-m8q1zzzz-1" }
    );
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["k3v7d2mq"],
      delivery: "woken",
      reason: "most recent",
    });
  });

  it("arm 3 reads the SESSION stamp too — a post that chose its own key still counts", async () => {
    twoLive();
    recentAgentPosts({
      seq: 42,
      client_msg_id: "my-own-key",
      metadata: { session_id: "chan-1::k3v7d2mq" },
    });
    expect((await resolve("morning")).recipientAgentIds).toEqual(["k3v7d2mq"]);
  });

  it("arm 4: nobody posted inside the window → the most recently LAUNCHED", async () => {
    twoLive();
    recentAgentPosts();
    const out = await resolve("morning");
    expect(out).toMatchObject({
      verdict: "responder",
      recipientAgentIds: ["m8q1zzzz"],
      reason: "most recently launched",
    });
  });

  it("the CONFIGURED responder still wins — an operator is never second-guessed by recency", async () => {
    twoLive();
    recentAgentPosts({ seq: 42, client_msg_id: "agent-k3v7d2mq-3" });
    const out = await resolve("morning", {}, {
      channel: { default_responder_agent_name: "agent-m8q1zzzz" },
    });
    expect(out).toMatchObject({
      recipientAgentIds: ["m8q1zzzz"],
      reason: "default",
    });
  });

  it("🔒 the arm-3 READ IS LAZY — a settled room pays for no round trip", async () => {
    roomProjection(sessionRow({ name: "k3v7d2mq" }));
    const out = await resolve("morning");
    expect(out.reason).toBe("only agent");
    expect(
      vi.mocked(repoMessages.listRecentRoomAgentPosts)
    ).not.toHaveBeenCalled();
  });

  it("a stale agent poster that is no longer live cannot be the answer", async () => {
    twoLive();
    recentAgentPosts({ seq: 42, client_msg_id: "agent-deadbeef-1" });
    // The recency list names an agent the room no longer holds, so arm 3 skips
    // it and arm 4 answers — never a wake aimed at a session that is gone.
    expect((await resolve("morning")).recipientAgentIds).toEqual(["m8q1zzzz"]);
  });
});
});
