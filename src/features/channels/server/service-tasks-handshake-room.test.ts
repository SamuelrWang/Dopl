/**
 * THE ROOM BOTH AGENTS CAN WRITE INTO — the seeding half of the two-agent
 * handshake (the convergence half is `service-tasks-handshake.test.ts`).
 *
 * Converging on one thread is not enough: a thread's write gate is the
 * creator/target PAIR until it has a participant set, so the agent that lost
 * the open race is 403'd out of the room it was told to join. `createTask`
 * therefore DERIVES that set, server-side, from the instruction the handshake
 * key names — and the derivation must not become a way around the curation
 * rule, which is what the last describe is for.
 *
 * The loser's write is driven through the REAL `postMessage` and the real
 * participant-aware gate, never asserted from the participant rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-agents");
vi.mock("./repository-messages");
vi.mock("./repository-participants");
vi.mock("./repository-tasks");
vi.mock("./service-reads");

import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import { createTask } from "./service-tasks";
import { joinThreadParticipant } from "./service-participants";
import { postMessage } from "./service-writes";
import { TaskForbiddenError } from "./errors";
import {
  ctxA,
  ctxB,
  ctxFor,
  HANDSHAKE_KEY,
  HUMAN,
  ONYX,
  openingsFor,
  open,
  OWNER_A,
  OWNER_B,
  participants,
  QUARTZ,
  resetFakes,
  setOf,
  STRANGER,
  tasks,
} from "./service-tasks-handshake.fixtures";

beforeEach(resetFakes);

describe("create_thread handshake — the room both agents can write into", () => {
  it("seeds BOTH agents, BOTH owners and the human who asked", async () => {
    const { thread } = await open(ctxA, HANDSHAKE_KEY);

    expect(setOf(thread.id)).toEqual(
      expect.arrayContaining([
        `agent:${QUARTZ}`,
        `agent:${ONYX}`,
        `user:${OWNER_A}`,
        `user:${OWNER_B}`,
        `user:${HUMAN}`,
      ])
    );
  });

  it("seeds the same set from the LOSER's call, so a half-built room repairs itself", async () => {
    // The winner's create lands the row and then dies before seeding.
    vi.mocked(repoParticipants.insertParticipant).mockRejectedValueOnce(
      new Error("connection reset")
    );
    await expect(open(ctxA, HANDSHAKE_KEY)).rejects.toThrow("connection reset");
    expect(participants).toHaveLength(0);

    const loser = await open(ctxB, HANDSHAKE_KEY);

    expect(setOf(loser.thread.id)).toEqual(
      expect.arrayContaining([`agent:${ONYX}`, `user:${OWNER_B}`])
    );
  });

  it("THE POINT: the loser can post into the thread it was told to join", async () => {
    const winner = await open(ctxA, HANDSHAKE_KEY);
    await open(ctxB, HANDSHAKE_KEY);

    const reply = await postMessage(ctxB, "general", {
      body: "onyx here, picking up the second half",
      metadata: { taskId: winner.thread.id },
      authorAgentId: ONYX,
    });

    // Driven through the real participant-aware write gate: the tag SURVIVED,
    // which is what puts the reply inside the thread's card and routes it.
    expect(reply.metadata.taskId).toBe(winner.thread.id);
  });

  it("and could NOT before the set existed — the seeding is what unlocks it", async () => {
    // The same thread, opened WITHOUT the handshake key: no participant rows,
    // so the creator/target pair gate is the whole rule and the second agent's
    // owner is neither.
    const { thread } = await open(ctxA, "dedupe-plain");
    expect(setOf(thread.id)).toEqual([]);

    await expect(
      postMessage(ctxB, "general", {
        body: "onyx here",
        metadata: { taskId: thread.id },
      })
    ).rejects.toBeInstanceOf(TaskForbiddenError);
  });

  it("seeding twice is a no-op — the set is identical after a repeat create", async () => {
    const { thread } = await open(ctxA, HANDSHAKE_KEY);
    const first = setOf(thread.id).slice().sort();

    await open(ctxA, HANDSHAKE_KEY);
    await open(ctxB, HANDSHAKE_KEY);

    expect(setOf(thread.id).slice().sort()).toEqual(first);
    // No duplicate identities anywhere in the table.
    expect(new Set(setOf(thread.id)).size).toBe(setOf(thread.id).length);
  });
});

describe("create_thread handshake — what it must NOT widen", () => {
  it("does not admit a converging caller who is a stranger to the instruction", async () => {
    const winner = await open(ctxA, HANDSHAKE_KEY);

    // A channel member who was not addressed and owns none of the addressed
    // agents collides on the key. It converges on the thread (that is the
    // idempotency contract) and is NOT written into the room.
    const converged = await open(ctxFor(STRANGER), HANDSHAKE_KEY);

    expect(converged.thread.id).toBe(winner.thread.id);
    expect(setOf(winner.thread.id)).not.toContain(`user:${STRANGER}`);
    await expect(
      postMessage(ctxFor(STRANGER), "general", {
        body: "me too",
        metadata: { taskId: winner.thread.id },
      })
    ).rejects.toBeInstanceOf(TaskForbiddenError);
  });

  it("ignores a converging caller's OWN participants array (the create route is not a join route)", async () => {
    const winner = await open(ctxA, HANDSHAKE_KEY);

    await createTask(ctxFor(STRANGER), "general", {
      title: "Work together on X",
      body: "…",
      toUserId: HUMAN,
      clientMsgId: HANDSHAKE_KEY,
      participants: [{ kind: "user", id: STRANGER }],
    });

    // Otherwise a colliding key would be the curation rule reached through the
    // create route: any member could write themselves into any thread.
    expect(setOf(winner.thread.id)).not.toContain(`user:${STRANGER}`);
  });

  it("leaves the CURATION rule exactly where it was — a stranger's join is still 403", async () => {
    const { thread } = await open(ctxA, HANDSHAKE_KEY);

    await expect(
      joinThreadParticipant(ctxFor(STRANGER), "general", thread.id, {
        kind: "user",
        id: STRANGER,
      })
    ).rejects.toBeInstanceOf(TaskForbiddenError);
  });

  it("still re-drives the CREATOR's own participants on a retry", async () => {
    const first = await createTask(ctxA, "general", {
      title: "Work together on X",
      body: "…",
      toUserId: HUMAN,
      clientMsgId: HANDSHAKE_KEY,
      participants: [{ kind: "user", id: STRANGER }],
    });
    participants.length = 0;

    await createTask(ctxA, "general", {
      title: "Work together on X",
      body: "…",
      toUserId: HUMAN,
      clientMsgId: HANDSHAKE_KEY,
      participants: [{ kind: "user", id: STRANGER }],
    });

    // The creator IS a curator, so its retry repairs the set it asked for.
    expect(setOf(first.thread.id)).toContain(`user:${STRANGER}`);
  });
});

describe("create_thread — the ordinary path is untouched", () => {
  it("a create with NO client_msg_id writes no participant rows and reads no trigger", async () => {
    const { thread, openingSeq } = await open(ctxA);

    expect(tasks).toHaveLength(1);
    expect(setOf(thread.id)).toEqual([]);
    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
    expect(openingsFor(thread.id)).toHaveLength(1);
    expect(openingSeq).toBe(openingsFor(thread.id)[0].seq);
  });

  it("an ordinary idempotency key still dedups, and still seeds nothing", async () => {
    const first = await open(ctxA, "dedupe-plain");
    const again = await open(ctxA, "dedupe-plain");

    expect(again.thread.id).toBe(first.thread.id);
    expect(tasks).toHaveLength(1);
    expect(openingsFor(first.thread.id)).toHaveLength(1);
    expect(setOf(first.thread.id)).toEqual([]);
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("a handshake key whose trigger addressed nobody behaves like an ordinary key", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(null);

    const { thread } = await open(ctxA, HANDSHAKE_KEY);

    expect(setOf(thread.id)).toEqual([]);
    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
  });
});
