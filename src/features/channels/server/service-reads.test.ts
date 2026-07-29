/**
 * Unit tests for the channels read service — the `listChannelMembers`
 * notify-scope privacy rule. Repository mocked; service-shared runs for real.
 *
 * Invariant: `notify_scope` is a private per-member preference. The roster
 * exposes it ONLY on the caller's OWN row; every other member's `notifyScope`
 * is nulled so no one can see who muted the channel.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-collab");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import {
  getChannelTask,
  listChannelMembers,
  listChannelTasks,
  listChannels,
  readMessages,
} from "./service-reads";
import { TaskNotFoundError } from "./errors";
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
    vi.mocked(repo.listMessages).mockResolvedValue([]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });

  it("skips the watermark write when nothing is newer than the current watermark", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue({
      ...memberRow(USER, "all"),
      last_read_at: "2026-07-27T12:00:00.000Z",
    });
    vi.mocked(repo.listMessages).mockResolvedValue([
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
    vi.mocked(repo.listMessages).mockResolvedValue([
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
    vi.mocked(repo.listMessages).mockResolvedValue([
      messageRow(1, "2026-07-27T10:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).toHaveBeenCalledWith(
      "chan-1",
      USER,
      "2026-07-27T10:00:00.000Z"
    );
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
    vi.mocked(repo.lastMessages).mockResolvedValue(new Map());
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
