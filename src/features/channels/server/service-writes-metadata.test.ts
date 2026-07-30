/**
 * Unit tests for the post-metadata folds — driven through `postMessage` so the
 * wiring is covered too. The repository + task repository are mocked.
 *
 * Focus: the delivery bug this file exists for. An agent reply posted over MCP
 * into a DM carried NO `to_user_id` and NO `taskId`, so the peer's desktop read
 * it as an unaddressed agent message (the deliberate loop brake → ignore) and
 * had no task id to route it to the waiting session. The server now stamps
 * both, and it must do so WITHOUT weakening the anti-spoof strip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const TASK_ID = "44444444-e29b-41d4-a716-446655440000";
const OTHER_TASK_ID = "55555555-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "dm",
    name: "Direct message",
    topic: "",
    visibility: "private",
    is_direct: true,
    direct_key: [USER, PEER].sort().join(":"),
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
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
    joined_at: "2026-07-29T00:00:00Z",
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
    created_by: PEER,
    target_user_id: USER,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

function insertedRow(
  row: Parameters<typeof repo.insertMessage>[0]
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
    created_at: "2026-07-29T00:00:00Z",
  };
}

/** The metadata object handed to `repo.insertMessage`. */
function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repo.insertMessage).mock.calls[0][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER ? memberRow(userId) : null
  );
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER, "owner"),
    memberRow(PEER),
  ]);
  vi.mocked(repo.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
});

describe("postMessage — DM auto-address", () => {
  it("stamps the peer as to_user_id when a DM post carries no `to`", async () => {
    const msg = await postMessage(ctx, "dm", { body: "on it" });

    expect(capturedMetadata().to_user_id).toBe(PEER);
    expect(msg.metadata.to_user_id).toBe(PEER);
  });

  it("an explicit `to` is never overridden by the auto-address", async () => {
    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(capturedMetadata().to_user_id).toBe(USER);
  });

  it("leaves a NON-direct channel unaddressed (3+ members are ambiguous)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ is_direct: false, direct_key: null })
    );

    await postMessage(ctx, "dm", { body: "general chat" });

    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("stamps nothing (and still posts) when the DM peer cannot be resolved", async () => {
    // A torn-down roster: only the author's own membership survives.
    vi.mocked(repo.listMembers).mockResolvedValue([memberRow(USER, "owner")]);

    await postMessage(ctx, "dm", { body: "hello" });

    expect(repo.insertMessage).toHaveBeenCalledTimes(1);
    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
  });

  it("stamps nothing when a would-be third member makes the peer ambiguous", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "owner"),
      memberRow(PEER),
      memberRow(THIRD),
    ]);

    await postMessage(ctx, "dm", { body: "hello" });

    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
  });

  it("SECURITY: a caller-supplied metadata to_user_id is still stripped, then replaced by the validated peer", async () => {
    await postMessage(ctx, "dm", {
      body: "hello",
      metadata: { to_user_id: THIRD, keep: 1 },
    });

    const meta = capturedMetadata();
    // The spoofed non-member never survives; the stamp comes from the roster.
    expect(meta.to_user_id).toBe(PEER);
    expect(meta.keep).toBe(1);
  });
});

describe("postMessage — DM task-id inheritance", () => {
  it("inherits the single open task and fires the reserved-key stamping", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "here is the answer" });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    // The desktop's routing / suppression predicates read exactly these.
    expect(meta.taskMode).toBe("interactive");
    expect(meta.taskCreatedBy).toBe(PEER);
    expect(meta.taskTitle).toBe("Wire the listener");
    expect(meta.taskTarget).toBe(USER);
    expect(meta.to_user_id).toBe(PEER);
    // Inheritance resolves off the channel's task list — no second lookup.
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
  });

  it("inherits a task the AUTHOR created and addressed to the peer", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow({ created_by: USER, target_user_id: PEER, mode: "autonomous" }),
    ]);

    await postMessage(ctx, "dm", { body: "any progress?" });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.taskMode).toBe("autonomous");
  });

  it("stamps nothing with 2+ open candidates (which task is ambiguous)", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow(),
      taskRow({ id: OTHER_TASK_ID, created_by: USER, target_user_id: PEER }),
    ]);

    await postMessage(ctx, "dm", { body: "reply" });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
  });

  it("ignores CLOSED tasks and tasks whose participants are not {author, peer}", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow({ status: "closed", outcome: "completed" }),
      taskRow({ id: OTHER_TASK_ID, created_by: THIRD, target_user_id: USER }),
      taskRow({ id: OTHER_TASK_ID, created_by: USER, target_user_id: null }),
    ]);

    await postMessage(ctx, "dm", { body: "reply" });

    const meta = capturedMetadata();
    expect(has(meta, "taskId")).toBe(false);
    expect(has(meta, "taskMode")).toBe(false);
  });

  it("a caller-supplied taskId suppresses inheritance (explicit threading wins)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ id: OTHER_TASK_ID, title: "Explicit" })
    );

    await postMessage(ctx, "dm", {
      body: "reply",
      metadata: { taskId: OTHER_TASK_ID },
    });

    expect(capturedMetadata().taskId).toBe(OTHER_TASK_ID);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("a legacy task-<uuid>-<seq> id suppresses inheritance and stamps nothing", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", {
      body: "reply",
      metadata: { taskId: "task-chan-1-7" },
    });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe("task-chan-1-7");
    expect(has(meta, "taskMode")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("never inherits in a NON-direct channel", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ is_direct: false, direct_key: null })
    );

    await postMessage(ctx, "dm", { body: "reply", toUserId: PEER });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("never inherits onto a lifecycle event (a marker must not land on someone else's task)", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "done", kind: "task_finished" });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("does not inherit when the post is explicitly addressed away from the peer", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
  });
});
