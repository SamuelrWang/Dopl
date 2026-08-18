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

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
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
  ChannelTaskActivityRow,
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

  function taskRow(overrides: Partial<ChannelTaskActivityRow> = {}): ChannelTaskActivityRow {
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
      last_activity_at: "2026-07-27T00:00:00Z",
      ...overrides,
    };
  }

  /** The row shape a SINGLE-thread read returns — `channel_tasks` has no
   *  activity column, so the derived one is simply not there. */
  function withoutActivity(row: ChannelTaskActivityRow): ChannelTaskRow {
    const copy: Record<string, unknown> = { ...row };
    delete copy.last_activity_at;
    return copy as unknown as ChannelTaskRow;
  }

  it("lists the channel's tasks (visibility-gated) as DTOs", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [
        taskRow({ id: TASK_ID, title: "A" }),
        taskRow({
          id: "other",
          title: "B",
          status: "closed",
          outcome: "completed",
        }),
      ],
      truncated: false,
    });

    const { threads, truncated } = await listChannelTasks(ctx, "general");

    expect(repoTasks.listTasksByChannel).toHaveBeenCalledWith("chan-1");
    // ⚠ The REPOSITORY's order rides through untouched — the service does not
    // re-sort, because the repository's LIMIT clipped against that order.
    expect(threads.map((t) => t.title)).toEqual(["A", "B"]);
    expect(threads[1].outcome).toBe("completed");
    expect(truncated).toBe(false);
  });

  it("carries the derived activity clock onto the DTO", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow({ last_activity_at: "2026-08-18T09:00:00Z" })],
      truncated: false,
    });

    const { threads } = await listChannelTasks(ctx, "general");

    // The sidebar's 24h window is arithmetic over THIS field, so losing it in
    // the mapper renders every thread inactive rather than failing.
    expect(threads[0].lastActivityAt).toBe("2026-08-18T09:00:00Z");
  });

  it("passes the CLIP through instead of swallowing it", async () => {
    // A bounded read at its ceiling is indistinguishable from an exhausted one
    // (INVARIANTS §9) — the flag is the only thing that tells them apart, and a
    // service that drops it presents a partial list as the whole one.
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: true,
    });

    const { truncated } = await listChannelTasks(ctx, "general");

    expect(truncated).toBe(true);
  });

  it("does NOT claim an activity clock on a single-thread read", async () => {
    // `get_thread` loads one row off `channel_tasks`, which has no such column.
    // ⚠ Absent means "this view did not derive it", never "no activity" — a
    // fallback to `createdAt` here would sort a live thread as cold.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      withoutActivity(taskRow())
    );

    const task = await getChannelTask(ctx, "general", TASK_ID);

    expect(task.lastActivityAt).toBeUndefined();
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
