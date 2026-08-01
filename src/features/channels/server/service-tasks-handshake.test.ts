/**
 * ONE INSTRUCTION MUST PRODUCE ONE THREAD.
 *
 * A human addresses two agents ("@quartz @onyx work together on X"), both
 * machines wake, and both may call `create_thread` with the same derived
 * `thread-open-<channelId>-<seq>` key. This suite is the convergence half: one
 * `channel_tasks` row, one opening message, both callers holding the SAME
 * thread, and the loser coming away with a real await cursor rather than a
 * `null` that would send it back for a racy `read limit=1`.
 *
 * The race is real, not staged — see `service-tasks-handshake.fixtures.ts`. The
 * room the two agents then share is `service-tasks-handshake-room.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-agents");
vi.mock("./repository-messages");
vi.mock("./repository-participants");
vi.mock("./repository-tasks");
vi.mock("./service-reads");

import * as repoMessages from "./repository-messages";
import {
  ctxA,
  ctxB,
  HANDSHAKE_KEY,
  messages,
  openingsFor,
  open,
  OWNER_A,
  resetFakes,
  tasks,
} from "./service-tasks-handshake.fixtures";

beforeEach(resetFakes);

describe("create_thread handshake — two agents, one instruction, ONE thread", () => {
  it("two CONCURRENT creates with the same key converge on one thread and one opening message", async () => {
    const [a, b] = await Promise.all([
      open(ctxA, HANDSHAKE_KEY),
      open(ctxB, HANDSHAKE_KEY),
    ]);

    // One row in `channel_tasks`, and BOTH callers hold it.
    expect(tasks).toHaveLength(1);
    expect(a.thread.id).toBe(tasks[0].id);
    expect(b.thread.id).toBe(a.thread.id);
    // One initiating request — not two, so the operator sees one ask and the
    // responder's machine spawns one session.
    expect(openingsFor(a.thread.id)).toHaveLength(1);
  });

  it("the loser is handed the WINNER's thread — not an error, not a second row", async () => {
    const winner = await open(ctxA, HANDSHAKE_KEY);
    const loser = await open(ctxB, HANDSHAKE_KEY);

    expect(loser.thread.id).toBe(winner.thread.id);
    expect(loser.thread.createdBy).toBe(OWNER_A);
    expect(tasks).toHaveLength(1);
  });

  it("the loser gets the stored opening seq as its await cursor, never a fresh post", async () => {
    const winner = await open(ctxA, HANDSHAKE_KEY);
    const before = messages.length;

    const loser = await open(ctxB, HANDSHAKE_KEY);

    // A READ of the winner's opening message, so the loser can arm `await`
    // without a `read limit=1` round-trip that races the winner's first reply.
    expect(loser.openingSeq).toBe(winner.openingSeq);
    expect(messages).toHaveLength(before);
  });

  it("reports null rather than a guess when the winner has not posted yet", async () => {
    // The winner inserted its row and died before its opening post.
    vi.mocked(repoMessages.insertMessage).mockRejectedValueOnce(
      new Error("connection reset")
    );
    await expect(open(ctxA, HANDSHAKE_KEY)).rejects.toThrow("connection reset");

    const loser = await open(ctxB, HANDSHAKE_KEY);

    expect(loser.thread.id).toBe(tasks[0].id);
    expect(loser.openingSeq).toBeNull();
  });
});

