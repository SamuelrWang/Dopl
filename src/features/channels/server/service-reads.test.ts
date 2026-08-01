/**
 * Unit tests for the channels read service. Repository mocked; service-shared
 * runs for real.
 *
 * Covers:
 *   - `listChannelMembers` notify-scope privacy — `notify_scope` is a private
 *     per-member preference, exposed ONLY on the caller's OWN row so no one can
 *     see who muted the channel;
 *   - the read-watermark loop guard (content-derived + monotonic);
 *   - the THREAD SCOPE on `readMessages` — the `metadata.taskId` filter that
 *     isolates one exchange, its legacy-id tolerance, and the two things it must
 *     NOT do: move the watermark, or soften the read-visibility gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import * as repoParticipants from "./repository-participants";
import {
  getChannelTask,
  listChannelMembers,
  listChannelTasks,
  listChannels,
  readMessages,
} from "./service-reads";
import { ChannelNotFoundError, TaskNotFoundError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";

const WS = "ws-1";
const USER = "user-1";
const OTHER = "user-2";
/** A first-class thread id (`metadata.taskId`), as the read scope receives it. */
const TASK_THREAD_ID = "660e8400-e29b-41d4-a716-446655440111";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  };
}

function memberRow(userId: string, notifyScope: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: userId === USER ? "owner" : "member",
    last_read_at: null,
    notify_scope: notifyScope,
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Multiplayer: every thread-tagged post runs the participant-aware write
  // gate, and every thread read hydrates a participant set. No participants =
  // the pair gate, which is what these suites are about.
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoParticipants.listParticipantsByTasks).mockResolvedValue(new Map());
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  // loadVisibleChannel gate: caller is a member of the private channel.
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "none"));
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  // Presence hydration: no one online by default.
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
});

describe("listChannelMembers — notify_scope privacy", () => {
  it("exposes the caller's own notifyScope, nulls every other member's", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "none"), // caller — muted; must stay visible to self
      memberRow(OTHER, "all"), // teammate — scope must be hidden
    ]);

    const members = await listChannelMembers(ctx, "general");

    const mine = members.find((m) => m.userId === USER);
    const theirs = members.find((m) => m.userId === OTHER);
    expect(mine?.notifyScope).toBe("none");
    expect(theirs?.notifyScope).toBeNull();
    // agent_tool_profile is private the same way: self only.
    expect(mine?.agentToolProfile).toBe("full");
    expect(theirs?.agentToolProfile).toBeNull();
    // Other roster fields for the teammate are still present.
    expect(theirs?.role).toBe("member");
  });

  it("exposes presence (agentOnline / lastSeenAt) for every member", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "all"),
      memberRow(OTHER, "all"),
    ]);
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
      new Map([[OTHER, { online: true, lastSeenAt: "2026-07-26T00:00:00Z" }]])
    );

    const members = await listChannelMembers(ctx, "general");
    const mine = members.find((m) => m.userId === USER);
    const theirs = members.find((m) => m.userId === OTHER);
    // Presence is NOT private — a teammate's online agent must be visible.
    expect(theirs?.agentOnline).toBe(true);
    expect(theirs?.lastSeenAt).toBe("2026-07-26T00:00:00Z");
    expect(mine?.agentOnline).toBe(false);
  });
});

describe("readMessages — read-watermark loop guard (2026-07-27 CPU incident)", () => {
  // The watermark must be content-derived and monotonic: a refetch that
  // shows nothing new must NOT write (a write is a realtime event that
  // re-fires every subscribed tab — the self-sustaining refetch loop).
  function messageRow(seq: number, createdAt: string): ChannelMessageRow {
    return {
      id: `msg-${seq}`,
      seq,
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: OTHER,
      author_kind: "user",
      kind: "message",
      body: "hi",
      metadata: {},
      client_msg_id: null,
      created_at: createdAt,
    };
  }

  it("skips the watermark write when the thread is empty", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });

  it("skips the watermark write when nothing is newer than the current watermark", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue({
      ...memberRow(USER, "all"),
      last_read_at: "2026-07-27T12:00:00.000Z",
    });
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(1, "2026-07-27T11:00:00.000Z"),
      messageRow(2, "2026-07-27T12:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });

  it("advances the watermark to the newest message shown (not now())", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue({
      ...memberRow(USER, "all"),
      last_read_at: "2026-07-27T12:00:00.000Z",
    });
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(3, "2026-07-27T12:30:00.000Z"),
      messageRow(4, "2026-07-27T13:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).toHaveBeenCalledTimes(1);
    expect(repo.updateLastRead).toHaveBeenCalledWith(
      "chan-1",
      USER,
      "2026-07-27T13:00:00.000Z"
    );
  });

  it("writes on first read (null watermark) with the newest message time", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(1, "2026-07-27T10:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).toHaveBeenCalledWith(
      "chan-1",
      USER,
      "2026-07-27T10:00:00.000Z"
    );
  });

  // A thread-scoped read shows a SUBSET, so its newest row can be newer than
  // unrelated messages the member has never seen. The watermark is monotonic,
  // so advancing it here would mark those read. Reading one exchange is not
  // viewing the channel.
  it("moves NO watermark when the read is scoped to one thread", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(9, "2026-07-27T18:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50, thread: TASK_THREAD_ID });
    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });
});

describe("readMessages — thread scope", () => {
  function threadRow(seq: number, taskId: string): ChannelMessageRow {
    return {
      id: `msg-${seq}`,
      seq,
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: OTHER,
      author_kind: "user",
      kind: "message",
      body: "hi",
      metadata: { taskId },
      client_msg_id: null,
      created_at: "2026-07-31T00:00:00Z",
    };
  }

  it("passes the thread id down to the repository as threadId", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      threadRow(4, TASK_THREAD_ID),
    ]);

    const messages = await readMessages(ctx, "general", {
      limit: 50,
      thread: TASK_THREAD_ID,
    });

    expect(repoMessages.listMessages).toHaveBeenCalledWith("chan-1", {
      since: undefined,
      limit: 50,
      threadId: TASK_THREAD_ID,
    });
    expect(messages.map((m) => m.seq)).toEqual([4]);
  });

  it("accepts a legacy task-<channelId>-<seq> id unchanged", async () => {
    const legacy = "task-chan-1-42";
    vi.mocked(repoMessages.listMessages).mockResolvedValue([threadRow(6, legacy)]);

    await readMessages(ctx, "general", { limit: 50, thread: legacy });

    expect(
      vi.mocked(repoMessages.listMessages).mock.calls[0][1].threadId
    ).toBe(legacy);
  });

  it("returns [] when the thread id matches nothing (a filter, not a lookup)", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([]);

    await expect(
      readMessages(ctx, "general", { limit: 50, thread: "task-nothing-0" })
    ).resolves.toEqual([]);
  });

  it("leaves the unfiltered read untouched (threadId undefined)", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([]);

    await readMessages(ctx, "general", { since: 3, limit: 50 });

    expect(repoMessages.listMessages).toHaveBeenCalledWith("chan-1", {
      since: 3,
      limit: 50,
      threadId: undefined,
    });
  });

  it("still enforces the read-visibility gate (non-member, private channel)", async () => {
    // The scope is a filter on top of the gate, never a way around it.
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(
      readMessages(ctx, "general", { limit: 50, thread: TASK_THREAD_ID })
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
    expect(repoMessages.listMessages).not.toHaveBeenCalled();
  });
});

describe("listChannelTasks / getChannelTask — reads", () => {
  const TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

  function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
    return {
      id: TASK_ID,
      channel_id: "chan-1",
      workspace_id: WS,
      title: "Ship it",
      status: "open",
      outcome: null,
      mode: "interactive",
      created_by: USER,
      target_user_id: OTHER,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
      closed_at: null,
      outcome_summary: null,
      ...overrides,
    };
  }

  it("lists the channel's tasks (visibility-gated) as DTOs", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow({ id: TASK_ID, title: "A" }),
      taskRow({ id: "other", title: "B", status: "closed", outcome: "completed" }),
    ]);

    const tasks = await listChannelTasks(ctx, "general");

    expect(repoTasks.listTasksByChannel).toHaveBeenCalledWith("chan-1");
    expect(tasks.map((t) => t.title)).toEqual(["A", "B"]);
    expect(tasks[1].outcome).toBe("completed");
  });

  it("returns one task by id, scoped to the channel", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ outcome_summary: "done" })
    );

    const task = await getChannelTask(ctx, "general", TASK_ID);

    expect(repoTasks.findTaskByChannelAndId).toHaveBeenCalledWith("chan-1", TASK_ID);
    expect(task.id).toBe(TASK_ID);
    expect(task.outcomeSummary).toBe("done");
  });

  it("404s a task id that is not in this channel (id can't be probed)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      getChannelTask(ctx, "general", TASK_ID)
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  /**
   * Both thread reads carry the PARTICIPANT SET — the breakout room's
   * membership. A thread without one reports `[]`, never a missing field: a
   * legacy thread is not a thread whose set failed to load.
   */
  it("hydrates each listed thread's participant set in ONE grouped query", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow({ id: TASK_ID }),
      taskRow({ id: "other" }),
    ]);
    vi.mocked(repoParticipants.listParticipantsByTasks).mockResolvedValue(
      new Map([
        [
          TASK_ID,
          [
            {
              id: "p-1",
              task_id: TASK_ID,
              workspace_id: WS,
              kind: "agent",
              user_id: null,
              agent_id: "agent-1",
              added_by: USER,
              created_at: "2026-07-31T00:00:00Z",
            },
          ],
        ],
      ])
    );

    const tasks = await listChannelTasks(ctx, "general");

    expect(repoParticipants.listParticipantsByTasks).toHaveBeenCalledWith([
      TASK_ID,
      "other",
    ]);
    expect(tasks[0].participants.map((p) => p.agentId)).toEqual(["agent-1"]);
    // The thread with no set reports an empty one, not `undefined`.
    expect(tasks[1].participants).toEqual([]);
  });

  it("carries the participant set on the single-thread read too", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
    vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([
      {
        id: "p-1",
        task_id: TASK_ID,
        workspace_id: WS,
        kind: "user",
        user_id: OTHER,
        agent_id: null,
        added_by: USER,
        created_at: "2026-07-31T00:00:00Z",
      },
    ]);

    const task = await getChannelTask(ctx, "general", TASK_ID);

    expect(task.participants).toHaveLength(1);
    expect(task.participants[0].userId).toBe(OTHER);
    expect(task.participants[0].threadId).toBe(TASK_ID);
  });
});

describe("listChannels — direct peer resolution", () => {
  it("resolves the peer (other member) for a direct channel; null for a normal one", async () => {
    const directKey = [USER, OTHER].sort().join(":");
    vi.mocked(repo.listMyMemberships).mockResolvedValue([
      memberRow(USER, "all"),
      { ...memberRow(USER, "all"), channel_id: "dm-1" },
    ]);
    vi.mocked(repo.listChannels).mockResolvedValue([
      channelRow(),
      { ...channelRow(), id: "dm-1", is_direct: true, direct_key: directKey },
    ]);
    vi.mocked(repo.memberCounts).mockResolvedValue(new Map());
    vi.mocked(repoMessages.lastMessages).mockResolvedValue(new Map());
    vi.mocked(collab.channelMemberUserIds).mockResolvedValue(
      new Map([
        ["chan-1", [USER]],
        ["dm-1", [USER, OTHER]],
      ])
    );
    vi.mocked(repo.fetchProfiles).mockResolvedValue([
      { id: OTHER, email: "o@x.com", display_name: "Otto", avatar_url: "http://x/o.png" },
    ]);

    const channels = await listChannels(ctx, false);
    const normal = channels.find((c) => c.id === "chan-1");
    const dm = channels.find((c) => c.id === "dm-1");
    expect(normal?.isDirect).toBe(false);
    expect(normal?.directPeer).toBeNull();
    expect(dm?.isDirect).toBe(true);
    expect(dm?.directPeer).toMatchObject({
      userId: OTHER,
      displayName: "Otto",
      avatarUrl: "http://x/o.png",
    });
  });
});
