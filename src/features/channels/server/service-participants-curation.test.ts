/**
 * WHO MAY CHANGE A THREAD'S PARTICIPANT SET — the curation rule.
 *
 * Split from `service-participants.test.ts` (§2 cap): that file pins WHAT a set
 * may hold (channel members, agents of this channel) and the idempotency of
 * both writes. This one pins WHO may change it, which is a different question
 * and the one that was wrong.
 *
 * THE ESCALATION THIS CLOSES (B1). Join used to be gated on channel membership
 * alone. In a private channel {A, B, C}, a thread A opened for B has no
 * participant rows, so `mayWriteThread` applies the creator/target PAIR gate —
 * C cannot post into it. But C could POST to the participants route naming
 * themselves, get a 201, and thereby CREATE a set. The moment a set exists,
 * `mayWriteThread` switches regimes and the set decides, so C could then post
 * into A↔B's exchange — including a `task_failed` carrying `declined: true`,
 * which re-stamps the calm-terminal flags and renders "declined" on the pair's
 * card. That is the same forgery the reserved-key strip and the legacy-id gate
 * exist to prevent, reached through a route that was simply not gated.
 *
 * THE RULE, as implemented:
 *  - ADD: the thread's `created_by`, its `target_user_id`, or an existing USER
 *    participant. Nobody else — naming yourself buys nothing, because "add only
 *    myself" IS the escalation.
 *  - REMOVE: yourself, or an agent you OWN, always. Anyone else only for the
 *    creator or the target.
 *  - Owning an agent that is IN the set does not make you a curator, on the
 *    same reasoning `mayWriteThread` refuses to infer a human's write access
 *    from an agent they own.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-agents");
vi.mock("./repository-participants");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import { ChannelParticipantNotMemberError, TaskForbiddenError } from "./errors";
import {
  joinThreadParticipant,
  leaveThreadParticipant,
} from "./service-participants";
import { postMessage } from "./service-writes";
import type { ChannelAgentRow, ThreadParticipantRow } from "./agents-dto";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
/** The thread's two original parties. */
const CREATOR = "11111111-e29b-41d4-a716-446655440000";
const TARGET = "22222222-e29b-41d4-a716-446655440000";
/** C: a member of the channel, a stranger to the thread. */
const BYSTANDER = "33333333-e29b-41d4-a716-446655440000";
/** A member who was admitted to the set by one of the parties. */
const GUEST = "44444444-e29b-41d4-a716-446655440000";
/** Not in the channel at all. */
const OUTSIDER = "55555555-e29b-41d4-a716-446655440000";
const TASK_ID = "66666666-e29b-41d4-a716-446655440000";
/** An agent of this channel, owned by BYSTANDER. */
const AGENT_ID = "77777777-e29b-41d4-a716-446655440000";

const MEMBERS = [CREATOR, TARGET, BYSTANDER, GUEST];

function ctxFor(userId: string): ChannelContext {
  return { workspaceId: WS, userId, source: "user", role: "member" };
}

function channelRow(): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: CREATOR,
    slug: "room",
    name: "Room",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: CREATOR,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
  return {
    id: TASK_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    title: "Wire the listener",
    status: "open",
    outcome: null,
    mode: "interactive",
    created_by: CREATOR,
    target_user_id: TARGET,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

function participantRow(
  overrides: Partial<ThreadParticipantRow> = {}
): ThreadParticipantRow {
  return {
    id: "part-1",
    task_id: TASK_ID,
    workspace_id: WS,
    kind: "user",
    user_id: GUEST,
    agent_id: null,
    added_by: CREATOR,
    created_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** BYSTANDER's own agent, in this channel. */
function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: AGENT_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: BYSTANDER,
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 98,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-31T00:00:00Z",
  };
}

/** The set the thread currently holds — the one knob these cases turn. */
function setIs(rows: ThreadParticipantRow[]): void {
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue(rows);
}

function join(userId: string, identity: { kind: "user" | "agent"; id: string }) {
  return joinThreadParticipant(ctxFor(userId), "room", TASK_ID, identity);
}

function leave(
  userId: string,
  identity: { kind: "user" | "agent"; id: string }
) {
  return leaveThreadParticipant(ctxFor(userId), "room", TASK_ID, identity);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    MEMBERS.includes(userId) ? memberRow(userId) : null
  );
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoAgents.findAgentById).mockResolvedValue(agentRow());
  vi.mocked(repoParticipants.findParticipant).mockResolvedValue(null);
  vi.mocked(repoParticipants.insertParticipant).mockImplementation(async (row) =>
    participantRow({
      kind: row.kind,
      user_id: row.user_id,
      agent_id: row.agent_id,
    })
  );
  vi.mocked(repoParticipants.deleteParticipant).mockResolvedValue(undefined);
  setIs([]);
});

describe("B1 — a bystander cannot write themselves into someone else's thread", () => {
  it("403s the join (a channel member is not a thread curator)", async () => {
    await expect(join(BYSTANDER, { kind: "user", id: BYSTANDER })).rejects.toThrow(
      TaskForbiddenError
    );
    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
  });

  it("and after the refusal they STILL cannot post into the thread", async () => {
    await expect(
      join(BYSTANDER, { kind: "user", id: BYSTANDER })
    ).rejects.toThrow(TaskForbiddenError);

    // The set is still empty, so `mayWriteThread` is still the pair gate — the
    // whole point of the 403 above. Driven through `postMessage`, not the
    // private predicate, so the route the attack actually used is the one under
    // test.
    await expect(
      postMessage(ctxFor(BYSTANDER), "room", {
        body: "butting in",
        metadata: { taskId: TASK_ID },
      })
    ).rejects.toThrow(TaskForbiddenError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("and cannot forge the thread's OUTCOME with a calm-flagged task_failed", async () => {
    await expect(
      postMessage(ctxFor(BYSTANDER), "room", {
        body: "This request was declined.",
        kind: "task_failed",
        metadata: { taskId: TASK_ID, declined: true },
      })
    ).rejects.toThrow(TaskForbiddenError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("refuses BEFORE resolving the named identity (no membership probing)", async () => {
    // A 400 here would tell a caller with no authority over the thread whether
    // a given user id is a member of the channel.
    await expect(join(BYSTANDER, { kind: "user", id: OUTSIDER })).rejects.toThrow(
      TaskForbiddenError
    );
    expect(repo.findMembership).not.toHaveBeenCalledWith("chan-1", OUTSIDER);
  });
});

describe("the curation rule — who may ADD", () => {
  it("the CREATOR may add", async () => {
    const { created } = await join(CREATOR, { kind: "user", id: GUEST });

    expect(created).toBe(true);
    // No set read at all: the pair is a curator by identity, not by membership.
    expect(repoParticipants.listParticipantsByTask).not.toHaveBeenCalled();
  });

  it("the TARGET may add", async () => {
    await expect(join(TARGET, { kind: "user", id: GUEST })).resolves.toMatchObject(
      { created: true }
    );
  });

  it("an EXISTING USER PARTICIPANT may add (the room curates itself)", async () => {
    setIs([participantRow({ user_id: GUEST })]);

    await expect(
      join(GUEST, { kind: "user", id: BYSTANDER })
    ).resolves.toMatchObject({ created: true });
  });

  it("a bystander is refused even once a set EXISTS", async () => {
    setIs([participantRow({ user_id: GUEST })]);

    await expect(
      join(BYSTANDER, { kind: "user", id: BYSTANDER })
    ).rejects.toThrow(TaskForbiddenError);
  });

  it("owning an AGENT in the set does NOT make its owner a curator", async () => {
    // Mirrors `mayWriteThread`: inferring a human's authority from a process
    // they started quietly widens what that human may do.
    setIs([
      participantRow({ kind: "agent", user_id: null, agent_id: AGENT_ID }),
    ]);

    await expect(
      join(BYSTANDER, { kind: "user", id: BYSTANDER })
    ).rejects.toThrow(TaskForbiddenError);
  });

  it("a curator may add an agent they own", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: CREATOR })
    );

    const { participant } = await join(CREATOR, {
      kind: "agent",
      id: AGENT_ID,
    });

    expect(participant.agentId).toBe(AGENT_ID);
  });

  it("still validates the identity once the caller IS a curator", async () => {
    // Curation is authorization; it does not widen what a set may hold.
    await expect(join(CREATOR, { kind: "user", id: OUTSIDER })).rejects.toThrow(
      ChannelParticipantNotMemberError
    );
  });
});

describe("the curation rule — who may REMOVE", () => {
  it("leaving YOURSELF always works, curator or not", async () => {
    setIs([participantRow({ user_id: BYSTANDER })]);

    await expect(
      leave(BYSTANDER, { kind: "user", id: BYSTANDER })
    ).resolves.toBeUndefined();
    expect(repoParticipants.deleteParticipant).toHaveBeenCalledWith(
      TASK_ID,
      "user",
      BYSTANDER
    );
  });

  it("an owner may pull out an agent they OWN, curator or not", async () => {
    await expect(
      leave(BYSTANDER, { kind: "agent", id: AGENT_ID })
    ).resolves.toBeUndefined();
    expect(repoParticipants.deleteParticipant).toHaveBeenCalled();
  });

  it("403s an owner pulling out someone ELSE's agent", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: TARGET })
    );

    await expect(leave(BYSTANDER, { kind: "agent", id: AGENT_ID })).rejects.toThrow(
      TaskForbiddenError
    );
    expect(repoParticipants.deleteParticipant).not.toHaveBeenCalled();
  });

  it("403s a bystander ejecting someone else", async () => {
    await expect(leave(BYSTANDER, { kind: "user", id: GUEST })).rejects.toThrow(
      TaskForbiddenError
    );
    expect(repoParticipants.deleteParticipant).not.toHaveBeenCalled();
  });

  it("403s an EXISTING PARTICIPANT ejecting someone else (narrower than adding)", async () => {
    // Admitting grows a room the admitter is already in; ejecting takes
    // something away from an invited collaborator, so it stays with the pair.
    setIs([participantRow({ user_id: GUEST })]);

    await expect(leave(GUEST, { kind: "user", id: TARGET })).rejects.toThrow(
      TaskForbiddenError
    );
  });

  it("the CREATOR may eject anyone", async () => {
    await expect(
      leave(CREATOR, { kind: "user", id: GUEST })
    ).resolves.toBeUndefined();
  });

  it("the TARGET may eject anyone", async () => {
    await expect(
      leave(TARGET, { kind: "user", id: GUEST })
    ).resolves.toBeUndefined();
  });

  it("stays IDEMPOTENT past the gate — removing a non-participant is a no-op", async () => {
    await expect(
      leave(CREATOR, { kind: "user", id: BYSTANDER })
    ).resolves.toBeUndefined();
  });
});
