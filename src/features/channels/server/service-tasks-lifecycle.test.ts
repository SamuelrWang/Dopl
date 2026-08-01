/**
 * Unit tests for the thread lifecycle ECHO — the `task_finished` / `task_failed`
 * marker `closeTask` posts, the SEQ that marker rides back out on, and
 * `reopenTask`'s deliberate silence. Split out of `service-writes.test.ts`
 * (§2 cap): the echo is the thread lane's contract with the transcript, not
 * part of `postMessage`'s metadata folds.
 *
 * The repositories are mocked; `service-shared` runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as repoParticipants from "./repository-participants";
import { closeTask, reopenTask } from "./service-tasks";
import { TaskForbiddenError, TaskNotFoundError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";

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
    joined_at: "2026-07-20T00:00:00Z",
  };
}

/** Echo the insert back as a stored row so `hydrateOne` can map it. */
function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 1,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-20T00:00:00Z",
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
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
});

describe("closeTask — outcome summary (v1.7)", () => {
  const CLOSE_TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

  /** A task USER (the caller) is allowed to close (creator), open + untargeted. */
  function closableTask(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
    return {
      id: CLOSE_TASK_ID,
      channel_id: "chan-1",
      workspace_id: WS,
      title: "Ship it",
      status: "open",
      outcome: null,
      mode: "interactive",
      created_by: USER,
      target_user_id: null,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      closed_at: null,
      outcome_summary: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    // Resolves for BOTH the closeTask authz lookup and postMessage's re-stamp.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(closableTask());
    vi.mocked(repoTasks.updateTask).mockImplementation(async (_id, patch) =>
      closableTask({ ...patch, status: "closed" })
    );
  });

  /** The lifecycle echo `postMessage` wrote (the only insertMessage call). */
  function echoInsert() {
    return vi.mocked(repoMessages.insertMessage).mock.calls[0][0];
  }

  it("persists outcome_summary and echoes the summary as the close body", async () => {
    await closeTask(ctx, "general", CLOSE_TASK_ID, "completed", "Shipped v2 to prod");

    const patch = vi.mocked(repoTasks.updateTask).mock.calls[0][1];
    expect(patch.outcome_summary).toBe("Shipped v2 to prod");

    const echo = echoInsert();
    expect(echo.kind).toBe("task_finished");
    expect(echo.body).toBe("Shipped v2 to prod");
  });

  it("without a summary persists null and keeps the calm default body", async () => {
    await closeTask(ctx, "general", CLOSE_TASK_ID, "completed");

    const patch = vi.mocked(repoTasks.updateTask).mock.calls[0][1];
    expect(patch.outcome_summary).toBeNull();
    expect(echoInsert().body).toBe("Task completed");
  });

  it("a failed close with a blank summary falls back to the default body", async () => {
    await closeTask(ctx, "general", CLOSE_TASK_ID, "failed", "   ");

    const echo = echoInsert();
    expect(echo.kind).toBe("task_failed");
    expect(echo.body).toBe("Task failed");
  });
});

/**
 * The close's counterpart to `createTask`'s `openingSeq`. A close WRITES to the
 * transcript, so it moves the cursor; a requester that then arms `await` has to
 * know where the channel now ends. Guessing it (last known seq + 1) put the
 * cursor past a peer's already-delivered reply and the hold waited forever —
 * the seq is only knowable here, so it rides back out.
 */
describe("closeTask — lifecycle echo seq", () => {
  const CLOSE_TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

  function closableTask(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
    return {
      id: CLOSE_TASK_ID,
      channel_id: "chan-1",
      workspace_id: WS,
      title: "Ship it",
      status: "open",
      outcome: null,
      mode: "interactive",
      created_by: USER,
      target_user_id: null,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      closed_at: null,
      outcome_summary: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(closableTask());
    vi.mocked(repoTasks.updateTask).mockImplementation(async (_id, patch) =>
      closableTask({ ...patch, status: "closed" })
    );
  });

  it("returns the echo's seq alongside the closed thread", async () => {
    vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => ({
      ...insertedRow(row),
      seq: 137,
    }));

    const { thread, echoSeq } = await closeTask(
      ctx,
      "general",
      CLOSE_TASK_ID,
      "completed"
    );

    expect(echoSeq).toBe(137);
    expect(thread.status).toBe("closed");
    expect(thread.outcome).toBe("completed");
  });

  it("still closes — with a NULL seq — when only the echo post fails", async () => {
    // The row is already closed by the time the marker is written. Throwing
    // here would report a close that did happen as a failure, and the caller's
    // retry would re-close. "Closed, no echo" is what `echoSeq: null` says.
    vi.mocked(repoMessages.insertMessage).mockRejectedValue(
      new Error("transient insert failure")
    );

    const { thread, echoSeq } = await closeTask(
      ctx,
      "general",
      CLOSE_TASK_ID,
      "failed",
      "Gave up"
    );

    expect(echoSeq).toBeNull();
    expect(thread.status).toBe("closed");
    // The close itself still landed on the row, summary and all.
    expect(vi.mocked(repoTasks.updateTask).mock.calls[0][1]).toMatchObject({
      status: "closed",
      outcome: "failed",
      outcome_summary: "Gave up",
    });
  });

  it("does not swallow the close's OWN errors (authz is unchanged)", async () => {
    // Only the echo is tolerated. A caller who may not close still gets 403,
    // and nothing is written.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closableTask({ created_by: "someone-else", target_user_id: "another" })
    );

    await expect(
      closeTask(ctx, "general", CLOSE_TASK_ID, "completed")
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });
});

describe("reopenTask — authz + no-echo (v1.9, web-only)", () => {
  const REOPEN_TASK_ID = "770e8400-e29b-41d4-a716-446655440222";
  const OTHER = "990e8400-e29b-41d4-a716-446655440999";

  /** A CLOSED task with a stored outcome + summary, ready to be reopened. */
  function closedTask(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
    return {
      id: REOPEN_TASK_ID,
      channel_id: "chan-1",
      workspace_id: WS,
      title: "Ship it",
      status: "closed",
      outcome: "completed",
      mode: "interactive",
      created_by: USER,
      target_user_id: null,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      closed_at: "2026-07-21T00:00:00Z",
      outcome_summary: "Shipped v2",
      ...overrides,
    };
  }

  beforeEach(() => {
    // Echo the patch back as the reopened (open) row so mapTaskRow can map it.
    vi.mocked(repoTasks.updateTask).mockImplementation(async (_id, patch) =>
      closedTask({ ...patch } as Partial<ChannelTaskRow>)
    );
  });

  it("404s an unknown task (nothing updated)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      reopenTask(ctx, "general", REOPEN_TASK_ID)
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
  });

  it("forbids a member who is neither creator nor target", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ created_by: OTHER, target_user_id: OTHER })
    );
    await expect(
      reopenTask(ctx, "general", REOPEN_TASK_ID)
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
  });

  it("creator reopen clears the closed state in one CHECK-satisfying update", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ created_by: USER })
    );

    const task = await reopenTask(ctx, "general", REOPEN_TASK_ID);

    // status back to open with outcome / closed_at / outcome_summary nulled —
    // keeps (status='closed') = (outcome IS NOT NULL) satisfied.
    expect(vi.mocked(repoTasks.updateTask).mock.calls[0][1]).toEqual({
      status: "open",
      outcome: null,
      closed_at: null,
      outcome_summary: null,
    });
    expect(task.status).toBe("open");
    expect(task.outcome).toBeNull();
  });

  it("the target may also reopen", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ created_by: OTHER, target_user_id: USER })
    );
    await expect(
      reopenTask(ctx, "general", REOPEN_TASK_ID)
    ).resolves.toBeDefined();
    expect(repoTasks.updateTask).toHaveBeenCalledTimes(1);
  });

  it("posts NO lifecycle echo (the card flips back on refetch, not a marker)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ created_by: USER })
    );
    await reopenTask(ctx, "general", REOPEN_TASK_ID);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });
});
