/**
 * THE PARTICIPANT-AWARE THREAD-WRITE GATE — driven through `postMessage`.
 *
 * A stamped `metadata.taskId` is what puts a message inside a thread's card and
 * routes it to the other side's session window, so who may stamp one IS the
 * write permission. This file pins the multiplayer half of that decision; the
 * legacy-id half lives in `service-writes-metadata-thread.test.ts`.
 *
 * TWO REGIMES, and the split is "does this thread have participant rows":
 *  - **None** (every thread that existed before this wave, and every thread
 *    created without `participants`): the creator/target PAIR gate, byte for
 *    byte what it was. What keeps it that way is not "participants are seeded
 *    only on request" — that says nothing about the join route — it is the
 *    CURATION RULE (`service-participants.ts`, covered in
 *    `service-participants-curation.test.ts`): only someone already inside a
 *    thread may add a row, so a bystander cannot manufacture a set to be
 *    admitted by.
 *  - **Some** (a BREAKOUT ROOM): the SET decides, and the original pair stays
 *    valid. A user participant posts as themselves; an agent participant posts
 *    only when the caller CLAIMS that agent via `authorAgentId` — which is
 *    already proven to be the caller's own (`service-writes-agents.ts`).
 *
 * The claim requirement is the load-bearing part. Inferring the agent from
 * ownership instead would mean "any member who owns any agent in the set may
 * post into the thread as themselves", quietly widening a HUMAN's write access
 * on the strength of a process they started.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");
vi.mock("./repository-agents");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import { TaskForbiddenError } from "./errors";
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
/** The caller throughout: a channel member who is NOT the thread's pair. */
const USER = "11111111-e29b-41d4-a716-446655440000";
const CREATOR = "22222222-e29b-41d4-a716-446655440000";
const TARGET = "33333333-e29b-41d4-a716-446655440000";
const TASK_ID = "44444444-e29b-41d4-a716-446655440000";
const AGENT_ID = "55555555-e29b-41d4-a716-446655440000";
const OTHER_AGENT_ID = "66666666-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

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

/** A thread between CREATOR and TARGET — the caller is in neither seat. */
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
    user_id: CREATOR,
    agent_id: null,
    added_by: CREATOR,
    created_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** The caller's OWN agent, in this channel. */
function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: AGENT_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: USER,
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

function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

/** Post into the thread, optionally claiming one of the caller's agents. */
function postIntoThread(authorAgentId?: string) {
  return postMessage(ctx, "room", {
    body: "here is the answer",
    metadata: { taskId: TASK_ID },
    ...(authorAgentId ? { authorAgentId } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    memberRow(userId)
  );
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoAgents.findAgentById).mockResolvedValue(agentRow());
});

describe("thread-write gate — NO participant rows (unchanged pair gate)", () => {
  it("403s a channel member who is neither creator nor target", async () => {
    await expect(postIntoThread()).rejects.toThrow(TaskForbiddenError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("lets the CREATOR post", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER })
    );

    await postIntoThread();

    expect(capturedMetadata().taskId).toBe(TASK_ID);
  });

  it("lets the TARGET post", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ target_user_id: USER })
    );

    await postIntoThread();

    expect(capturedMetadata().taskId).toBe(TASK_ID);
  });

  it("a claimed agent grants NOTHING on a thread with no set", async () => {
    // The agent is the caller's own and valid — but with no participant rows
    // the pair gate is the whole rule, and it does not know about agents.
    await expect(postIntoThread(AGENT_ID)).rejects.toThrow(TaskForbiddenError);
  });
});

describe("thread-write gate — WITH participant rows (the set decides)", () => {
  it("lets a USER participant post", async () => {
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      participantRow(),
      participantRow({ id: "part-2", user_id: USER }),
    ]);

    await postIntoThread();

    expect(capturedMetadata().taskId).toBe(TASK_ID);
  });

  it("still 403s a member who is in NEITHER the pair nor the set", async () => {
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      participantRow(),
    ]);

    await expect(postIntoThread()).rejects.toThrow(TaskForbiddenError);
  });

  it("keeps the ORIGINAL PAIR valid even when a set exists", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER })
    );
    // A set that admitted collaborators must not evict the thread's author.
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      participantRow({ user_id: TARGET }),
    ]);

    await postIntoThread();

    expect(capturedMetadata().taskId).toBe(TASK_ID);
  });

  it("lets an AGENT participant post when the caller CLAIMS it", async () => {
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      participantRow({ kind: "agent", user_id: null, agent_id: AGENT_ID }),
    ]);

    await postIntoThread(AGENT_ID);

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.author_agent_id).toBe(AGENT_ID);
  });

  it("403s the same caller with NO claim (participation is not inferred from ownership)", async () => {
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      participantRow({ kind: "agent", user_id: null, agent_id: AGENT_ID }),
    ]);

    await expect(postIntoThread()).rejects.toThrow(TaskForbiddenError);
  });

  it("403s a claim on an agent that is NOT in the set", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ id: OTHER_AGENT_ID })
    );
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      participantRow({ kind: "agent", user_id: null, agent_id: AGENT_ID }),
    ]);

    await expect(postIntoThread(OTHER_AGENT_ID)).rejects.toThrow(
      TaskForbiddenError
    );
  });

  it("reads the set ONCE per post", async () => {
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      participantRow({ user_id: USER }),
    ]);

    await postIntoThread();

    expect(repoParticipants.listParticipantsByTask).toHaveBeenCalledTimes(1);
  });

  it("never reads the set when the post carries no thread tag", async () => {
    await postMessage(ctx, "room", { body: "just chatting" });

    expect(repoParticipants.listParticipantsByTask).not.toHaveBeenCalled();
  });
});
