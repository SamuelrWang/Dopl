// @vitest-environment jsdom
/**
 * `agent-panel.tsx › agentSentMessages` — WHAT ONE AGENT POSTED, as a pure
 * derivation.
 *
 * ⚠ ITS OWN FILE SINCE 2026-08-22, split out of `agents-tab.test.tsx` at the
 * 500-line cap when the per-instance cases landed (F-251) — and on a real seam,
 * not an arbitrary cut: everything left over there RENDERS a surface, while this
 * is a filter over a message list with no DOM in it. The two move for different
 * reasons.
 *
 * The property that fails quietly, and the reason this derivation exists at all:
 * **the desktop posts its agent's words over the OPERATOR'S OWN credential** with
 * `authorKind: "agent"` (INVARIANTS §5). So `authorKind` alone puts a teammate's
 * agent in my panel, the ACCOUNT is what separates mine from theirs — and since
 * multiplayer, neither one separates MY agents from EACH OTHER.
 */

import { describe, expect, it } from "vitest";
import { agentSentMessages } from "./agent-panel";
import { ME, PEER, message } from "./test-fixtures";

describe("agentSentMessages — what this agent actually posted", () => {
  const MINE = message({
    id: "m-mine",
    authorUserId: ME,
    authorKind: "agent",
    body: "posted by my agent",
    metadata: { taskId: "t-1" },
  });

  it("takes agent-authored rows on this thread under the viewer's OWN account", () => {
    expect(agentSentMessages([MINE], "t-1", ME).map((m) => m.id)).toEqual(["m-mine"]);
  });

  it("excludes a PEER's agent — `authorKind` alone would let it in", () => {
    const theirs = message({
      id: "m-theirs",
      authorUserId: PEER,
      authorKind: "agent",
      metadata: { taskId: "t-1" },
    });
    expect(agentSentMessages([theirs], "t-1", ME)).toEqual([]);
  });

  it("excludes my own HUMAN message, another thread, and lifecycle rows", () => {
    const human = message({ id: "m-h", authorUserId: ME, metadata: { taskId: "t-1" } });
    const other = message({
      id: "m-o",
      authorUserId: ME,
      authorKind: "agent",
      metadata: { taskId: "t-2" },
    });
    const lifecycle = message({
      id: "m-l",
      authorUserId: ME,
      authorKind: "agent",
      kind: "task_started",
      metadata: { taskId: "t-1" },
    });
    expect(agentSentMessages([human, other, lifecycle], "t-1", ME)).toEqual([]);
  });

  it("answers nothing for a session with no first-class thread", () => {
    // An empty taskId must not match every untagged row in the channel.
    const untagged = message({ id: "m-u", authorUserId: ME, authorKind: "agent" });
    expect(agentSentMessages([untagged, MINE], "", ME)).toEqual([]);
  });

  /**
   * ⚠ THE THREE PREDICATES ABOVE STOP AT THE THREAD (2026-08-22, F-251).
   * Multiplayer puts N of ONE operator's agents on one thread, all posting under
   * that one account with `authorKind: "agent"` — so every case above passes for
   * every sibling, and each agent's panel and window showed all of their words
   * as its own. The `client_msg_id` the writer stamped
   * (`main/session-outbound-tag.js › nextOwnPostId`) is the only thing on the
   * wire that tells them apart.
   */
  describe("and WHICH of my agents posted it", () => {
    const byA1 = message({
      id: "m-a1",
      authorUserId: ME,
      authorKind: "agent",
      body: "from a1b2c3d4",
      clientMsgId: "agent-a1b2c3d4-1",
      metadata: { taskId: "t-1" },
    });
    const byE5 = message({
      id: "m-e5",
      authorUserId: ME,
      authorKind: "agent",
      body: "from e5f6g7h8",
      clientMsgId: "agent-e5f6g7h8-2",
      metadata: { taskId: "t-1" },
    });

    it("gives each sibling ONLY its own posts", () => {
      expect(
        agentSentMessages([byA1, byE5], "t-1", ME, "a1b2c3d4").map((m) => m.id)
      ).toEqual(["m-a1"]);
      expect(
        agentSentMessages([byA1, byE5], "t-1", ME, "e5f6g7h8").map((m) => m.id)
      ).toEqual(["m-e5"]);
    });

    // ⚠ NOT A REFUSAL. A main that emits no `agentId` runs one agent per thread,
    // so the thread IS the instance and this must read as it always did.
    it("falls back to the thread when no instance is named", () => {
      expect(agentSentMessages([byA1, byE5], "t-1", ME).map((m) => m.id)).toEqual([
        "m-a1",
        "m-e5",
      ]);
      expect(
        agentSentMessages([byA1, byE5], "t-1", ME, "  ").map((m) => m.id)
      ).toEqual(["m-a1", "m-e5"]);
    });

    /**
     * ⚠ ONLY A POST ATTRIBUTED TO SOMEBODY ELSE IS DROPPED. Hiding everything
     * unstamped would silently shorten the lane on three real classes: a main
     * older than the stamp, an agent that supplied its own idempotency key, and
     * the machine's courtesy no-ops — `main/channel-post.js › postResult` stamps
     * those `agent-<channelId>-<seq>`, which is about the MACHINE, not an agent.
     */
    it("keeps a row no instance claims, including the channel-scoped stamp", () => {
      const unstamped = message({
        id: "m-u",
        authorUserId: ME,
        authorKind: "agent",
        metadata: { taskId: "t-1" },
      });
      const courtesy = message({
        id: "m-c",
        authorUserId: ME,
        authorKind: "agent",
        // ⚠ A CHANNEL UUID THAT STARTS WITH EIGHT ID-SHAPED CHARACTERS, on
        // purpose: `startsWith("agent-")` plus a loose id class would read
        // `abcd1234` as an agent id and hide this row from every lane. The
        // stamp regex is anchored at BOTH ends, and the uuid's later `-` groups
        // are what make that decisive.
        clientMsgId: "agent-abcd1234-5678-90ab-cdef-000000000000-3",
        metadata: { taskId: "t-1" },
      });
      expect(
        agentSentMessages([byA1, unstamped, courtesy], "t-1", ME, "a1b2c3d4").map(
          (m) => m.id
        )
      ).toEqual(["m-a1", "m-u", "m-c"]);
    });
  });
});

