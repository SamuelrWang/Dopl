/**
 * F6 — A CLOSED THREAD STILL ACCEPTS POSTS, and now it SAYS SO.
 *
 * WHY IT MATTERS. The post path resolved the thread row and read only its
 * participation columns; `status` / `closed_at` were written on close and
 * cleared on reopen and consulted NOWHERE on the write path. So a thread closed
 * at #355 took five further posts with no refusal and no warning: the closer
 * believed the exchange was over, the poster believed it was live, and nothing
 * in either result said otherwise.
 *
 * THE DECIDED BEHAVIOUR IS WARN, NOT REFUSE, and these tests pin that as much as
 * they pin the flag. A 403 would break the legitimate "one last word after the
 * close echo" pattern, and its remedy — reopen — has no MCP counterpart, so the
 * agent would be told to do something it cannot do. The message therefore lands,
 * unchanged in every respect, and the notice rides out beside it.
 *
 * Kept out of `service-writes-metadata.test.ts` and its `-thread` sibling only
 * because both are at the §2 size cap; the harness below is theirs, trimmed to
 * this fold.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
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
const TASK_ID = "44444444-e29b-41d4-a716-446655440000";
/** A legacy `task-{channelId}-{seq}` id — no row, so no status to read. */
const LEGACY_ID = "task-chan-1-7";

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
    created_by: USER,
    slug: "dm",
    name: "Direct message",
    topic: "",
    visibility: "private",
    is_direct: true,
    direct_key: [USER, PEER].sort().join(":"),
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
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
    joined_at: "2026-08-01T00:00:00Z",
  };
}

/** The thread USER is the target of — open unless a test closes it. */
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
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

/** The closed shape a real `close_thread` leaves behind. */
function closedTask(): ChannelTaskRow {
  return taskRow({
    status: "closed",
    outcome: "completed",
    closed_at: "2026-08-01T09:30:00Z",
    outcome_summary: "shipped",
  });
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 356,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-08-01T00:00:00Z",
  };
}

function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
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
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
  // The legacy opener: PEER asked USER, so USER is a participant of it.
  vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
    insertedRow({
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: PEER,
      author_kind: "agent",
      kind: "message",
      body: "please do X",
      metadata: { to_user_id: USER },
      client_msg_id: null,
    })
  );
});

describe("postMessage — the closed-thread notice (F6)", () => {
  it("ACCEPTS the post into a closed thread and reports threadClosed", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(closedTask());

    const msg = await postMessage(ctx, "dm", {
      body: "one last thing",
      metadata: { taskId: TASK_ID },
    });

    // WARN, NOT REFUSE — the message is stored, and stored THREADED.
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
    expect(msg.threadClosed).toBe(true);
    expect(capturedMetadata().taskId).toBe(TASK_ID);
  });

  it("changes NOTHING about the stored message — the notice is not metadata", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(closedTask());

    await postMessage(ctx, "dm", { body: "hi", metadata: { taskId: TASK_ID } });

    const meta = capturedMetadata();
    // The task keys are stamped exactly as they are for an open thread…
    expect(meta.taskTitle).toBe("Wire the listener");
    expect(meta.taskCreatedBy).toBe(PEER);
    // …and nothing new is written into the row.
    expect(Object.prototype.hasOwnProperty.call(meta, "threadClosed")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(meta, "status")).toBe(false);
  });

  it("reports NOTHING for an OPEN thread", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());

    const msg = await postMessage(ctx, "dm", {
      body: "still working",
      metadata: { taskId: TASK_ID },
    });

    expect(msg.threadClosed).toBeUndefined();
  });

  it("reports NOTHING for a post with no thread at all", async () => {
    const msg = await postMessage(ctx, "dm", { body: "just talking" });

    expect(msg.threadClosed).toBeUndefined();
  });

  it("reports NOTHING for a LEGACY id — it has no row, so no status", async () => {
    // The other half of "a `task-<channel>-<seq>` id is not a thread" (F4): it
    // can never be closed, because there is nothing to close.
    const msg = await postMessage(ctx, "dm", {
      body: "ad-hoc reply",
      metadata: { taskId: LEGACY_ID },
    });

    expect(msg.threadClosed).toBeUndefined();
    expect(capturedMetadata().taskId).toBe(LEGACY_ID);
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
  });

  it("reports it for an INHERITED thread never — inheritance only picks OPEN ones", async () => {
    // Belt and braces on `resolveInheritableTask`'s own `status === "open"`
    // filter: a closed thread is not a candidate, so an untagged DM reply can
    // never inherit one and can never warn about one.
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([closedTask()]);

    const msg = await postMessage(ctx, "dm", { body: "on it" });

    expect(msg.threadClosed).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(capturedMetadata(), "taskId")
    ).toBe(false);
  });
});
