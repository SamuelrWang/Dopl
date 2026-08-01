/**
 * Unit tests for thread participant sets — a breakout room's membership.
 *
 * Three rules carry the file:
 *  1. **A set may only admit identities the room already holds.** A user must
 *     be a channel member; an agent must be an agent OF THIS CHANNEL (an agent
 *     from another room has no listener here and could never be reached).
 *  2. **Joining is idempotent and leaving is a no-op when there is nothing to
 *     remove.** Both are retried by real clients, and neither retry is an error.
 *  3. **`create_thread` seeds a set ONLY when asked**, and when it does, the
 *     creator and the target go in with the extras — a set that admitted a
 *     teammate's agent but not the thread's own author would lock the author
 *     out of their own exchange the moment the participant gate takes over.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-agents");
vi.mock("./repository-participants");
vi.mock("./service-reads");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import * as reads from "./service-reads";
import {
  ChannelAgentNotInChannelError,
  ChannelForbiddenError,
  ChannelParticipantNotMemberError,
  TaskNotFoundError,
} from "./errors";
import {
  joinThreadParticipant,
  leaveThreadParticipant,
} from "./service-participants";
import { createTask } from "./service-tasks";
import type { ChannelAgentRow, ThreadParticipantRow } from "./agents-dto";
import type { ChannelMemberRow, ChannelRow, ChannelTaskRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const OUTSIDER = "33333333-e29b-41d4-a716-446655440000";
const TASK_ID = "44444444-e29b-41d4-a716-446655440000";
const AGENT_ID = "55555555-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
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
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
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
    created_by: USER,
    target_user_id: PEER,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: AGENT_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: PEER,
    name: "quartz",
    status: "active",
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
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
    user_id: PEER,
    agent_id: null,
    added_by: USER,
    created_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** The identities handed to `insertParticipant`, in call order. */
function insertedIdentities(): Array<{ kind: string; id: string | null }> {
  return vi
    .mocked(repoParticipants.insertParticipant)
    .mock.calls.map(([row]) => ({
      kind: row.kind,
      id: row.kind === "agent" ? row.agent_id : row.user_id,
    }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER ? memberRow(userId) : null
  );
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
  vi.mocked(repoParticipants.findParticipant).mockResolvedValue(null);
  vi.mocked(repoParticipants.insertParticipant).mockImplementation(
    async (row) =>
      participantRow({
        kind: row.kind,
        user_id: row.user_id,
        agent_id: row.agent_id,
      })
  );
  vi.mocked(repoParticipants.deleteParticipant).mockResolvedValue(undefined);
  vi.mocked(repoAgents.findAgentById).mockResolvedValue(agentRow());
});

describe("joinThreadParticipant", () => {
  it("admits a channel member and reports it as created", async () => {
    const { participant, created } = await joinThreadParticipant(
      ctx,
      "room",
      TASK_ID,
      { kind: "user", id: PEER }
    );

    expect(created).toBe(true);
    expect(participant.kind).toBe("user");
    expect(participant.userId).toBe(PEER);
    const row = vi.mocked(repoParticipants.insertParticipant).mock.calls[0][0];
    // The denormalized workspace comes from the THREAD row — a guard trigger
    // compares it to the parent's, so ctx is the wrong source.
    expect(row.workspace_id).toBe(WS);
    expect(row.added_by).toBe(USER);
    expect(row.agent_id).toBeNull();
  });

  it("admits an agent OF THIS CHANNEL", async () => {
    const { participant } = await joinThreadParticipant(ctx, "room", TASK_ID, {
      kind: "agent",
      id: AGENT_ID,
    });

    expect(participant.agentId).toBe(AGENT_ID);
    expect(
      vi.mocked(repoParticipants.insertParticipant).mock.calls[0][0].user_id
    ).toBeNull();
  });

  it("is IDEMPOTENT — a second join returns the existing row, uncreated", async () => {
    vi.mocked(repoParticipants.findParticipant).mockResolvedValue(
      participantRow()
    );

    const { participant, created } = await joinThreadParticipant(
      ctx,
      "room",
      TASK_ID,
      { kind: "user", id: PEER }
    );

    expect(created).toBe(false);
    expect(participant.id).toBe("part-1");
    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
  });

  it("400s a user who is not a member of the channel", async () => {
    await expect(
      joinThreadParticipant(ctx, "room", TASK_ID, {
        kind: "user",
        id: OUTSIDER,
      })
    ).rejects.toThrow(ChannelParticipantNotMemberError);
    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
  });

  it("400s an agent that belongs to ANOTHER channel", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ channel_id: "chan-other" })
    );

    await expect(
      joinThreadParticipant(ctx, "room", TASK_ID, {
        kind: "agent",
        id: AGENT_ID,
      })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
  });

  it("400s an agent id that names no agent at all", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(null);

    await expect(
      joinThreadParticipant(ctx, "room", TASK_ID, {
        kind: "agent",
        id: AGENT_ID,
      })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
  });

  it("403s a NON-MEMBER of the channel (readable is not curatable)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(
      joinThreadParticipant(ctx, "room", TASK_ID, { kind: "user", id: PEER })
    ).rejects.toThrow(ChannelForbiddenError);
  });

  it("404s a thread that is not in this channel (no cross-room probing)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);

    await expect(
      joinThreadParticipant(ctx, "room", TASK_ID, { kind: "user", id: PEER })
    ).rejects.toThrow(TaskNotFoundError);
  });
});

describe("leaveThreadParticipant", () => {
  it("removes the identity from the set", async () => {
    await leaveThreadParticipant(ctx, "room", TASK_ID, {
      kind: "agent",
      id: AGENT_ID,
    });

    expect(repoParticipants.deleteParticipant).toHaveBeenCalledWith(
      TASK_ID,
      "agent",
      AGENT_ID
    );
  });

  it("is idempotent — removing an identity that is not in the set is a no-op", async () => {
    // The repository's delete matches nothing and returns cleanly; the service
    // adds no existence check, so a retried leave never 404s.
    await expect(
      leaveThreadParticipant(ctx, "room", TASK_ID, {
        kind: "user",
        id: OUTSIDER,
      })
    ).resolves.toBeUndefined();
  });

  it("403s a non-member of the channel", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(
      leaveThreadParticipant(ctx, "room", TASK_ID, { kind: "user", id: PEER })
    ).rejects.toThrow(ChannelForbiddenError);
    expect(repoParticipants.deleteParticipant).not.toHaveBeenCalled();
  });
});

/**
 * `create_thread participants=` — the seeding half. Driven through `createTask`
 * so the wiring (and the ORDER relative to the opening post) is covered too.
 */
describe("createTask — participant seeding", () => {
  beforeEach(() => {
    vi.mocked(repoTasks.insertTask).mockResolvedValue(taskRow());
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
    vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
    vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
    vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => ({
      id: "msg-1",
      seq: 12,
      channel_id: row.channel_id,
      workspace_id: row.workspace_id,
      author_user_id: row.author_user_id,
      author_kind: row.author_kind,
      kind: row.kind,
      body: row.body,
      metadata: row.metadata,
      client_msg_id: row.client_msg_id,
      created_at: "2026-07-31T00:00:00Z",
    }));
    vi.mocked(reads.getChannel).mockResolvedValue(
      {} as Awaited<ReturnType<typeof reads.getChannel>>
    );
  });

  const baseInput = {
    title: "Wire the listener",
    body: "please do X",
    toUserId: PEER,
  };

  it("writes NO participant rows when the create asks for none", async () => {
    await createTask(ctx, "room", baseInput);

    // No rows = the thread keeps the creator/target pair gate, unchanged.
    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
  });

  it("treats an EMPTY participants array as asking for none", async () => {
    await createTask(ctx, "room", { ...baseInput, participants: [] });

    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
  });

  it("auto-adds the creator and the target alongside the extras", async () => {
    await createTask(ctx, "room", {
      ...baseInput,
      participants: [{ kind: "agent", id: AGENT_ID }],
    });

    expect(insertedIdentities()).toEqual([
      { kind: "user", id: USER },
      { kind: "user", id: PEER },
      { kind: "agent", id: AGENT_ID },
    ]);
  });

  it("does not double-insert an extra that is already the creator or target", async () => {
    await createTask(ctx, "room", {
      ...baseInput,
      participants: [{ kind: "user", id: PEER }],
    });

    expect(insertedIdentities()).toEqual([
      { kind: "user", id: USER },
      { kind: "user", id: PEER },
    ]);
  });

  it("seeds the set BEFORE the opening post (which runs the write gate)", async () => {
    const order: string[] = [];
    vi.mocked(repoParticipants.insertParticipant).mockImplementation(
      async (row) => {
        order.push("participant");
        return participantRow({ kind: row.kind, user_id: row.user_id });
      }
    );
    vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => {
      order.push("message");
      return {
        id: "msg-1",
        seq: 12,
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
    });

    await createTask(ctx, "room", {
      ...baseInput,
      participants: [{ kind: "agent", id: AGENT_ID }],
    });

    expect(order[order.length - 1]).toBe("message");
  });

  it("REFUSES the whole seed on an invalid extra, writing no rows", async () => {
    await expect(
      createTask(ctx, "room", {
        ...baseInput,
        participants: [{ kind: "user", id: OUTSIDER }],
      })
    ).rejects.toThrow(ChannelParticipantNotMemberError);

    // Validation runs over every extra before the first insert, so a rejected
    // create never leaves a half-built room.
    expect(repoParticipants.insertParticipant).not.toHaveBeenCalled();
  });
});
