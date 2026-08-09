/**
 * Unit tests for the CLOSE half of `service-tasks-lifecycle.ts` — authorization,
 * the `task_finished` / `task_failed` echo, the SEQ that marker rides back out
 * on, the already-closed guard (C-30) and the echo's idempotency key. The REOPEN
 * half is `service-tasks-reopen.test.ts` (§2 cap; the two halves are also two
 * distinct contracts).
 *
 * The repositories are mocked; `service-shared` runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { closeEchoClientMsgId, closeTask } from "./service-tasks-lifecycle";
import { TaskForbiddenError, TaskNotFoundError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const CREATOR = "user-9";
const TARGET = "user-8";
const CLOSE_TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

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

/** The lifecycle echo `postMessage` wrote (the only insertMessage call). */
function echoInsert() {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0];
}

/** The patch the conditional close applied. */
function closePatch() {
  return vi.mocked(repoTasks.updateTaskIfStatus).mock.calls[0][2];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  // Resolves for BOTH the closeTask authz lookup and postMessage's re-stamp.
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(closableTask());
  vi.mocked(repoTasks.updateTaskIfStatus).mockImplementation(
    async (_id, _status, patch) => closableTask({ ...patch, status: "closed" })
  );
});

describe("closeTask — authorization", () => {
  it("404s an unknown task", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      closeTask(ctx, "general", CLOSE_TASK_ID, "completed")
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("allows the creator to close", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closableTask({ created_by: USER, target_user_id: TARGET })
    );

    await closeTask(ctx, "general", CLOSE_TASK_ID, "completed");

    expect(closePatch()).toMatchObject({ status: "closed", outcome: "completed" });
  });

  it("allows the target to close", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closableTask({ created_by: CREATOR, target_user_id: USER })
    );
    await expect(
      closeTask(ctx, "general", CLOSE_TASK_ID, "failed")
    ).resolves.toBeDefined();
  });

  it("forbids a member who is neither creator nor target", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closableTask({ created_by: CREATOR, target_user_id: TARGET })
    );
    await expect(
      closeTask(ctx, "general", CLOSE_TASK_ID, "completed")
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expect(repoTasks.updateTaskIfStatus).not.toHaveBeenCalled();
  });
});

describe("closeTask — outcome summary (v1.7)", () => {
  it("persists outcome_summary and echoes the summary as the close body", async () => {
    await closeTask(ctx, "general", CLOSE_TASK_ID, "completed", "Shipped v2 to prod");

    expect(closePatch().outcome_summary).toBe("Shipped v2 to prod");

    const echo = echoInsert();
    expect(echo.kind).toBe("task_finished");
    expect(echo.body).toBe("Shipped v2 to prod");
  });

  it("without a summary persists null and keeps the calm default body", async () => {
    await closeTask(ctx, "general", CLOSE_TASK_ID, "completed");

    expect(closePatch().outcome_summary).toBeNull();
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
    expect(closePatch()).toMatchObject({
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
    expect(repoTasks.updateTaskIfStatus).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });
});

/**
 * C-30 — THE ALREADY-CLOSED GUARD, both halves of it.
 *
 * The update is conditional (`WHERE status = 'open'`), so the transition itself
 * picks the winner and a second close writes nothing; and the echo carries a
 * `client_msg_id` keyed on the close it describes, so even two racers that both
 * reached `postMessage` would leave ONE entry in the transcript.
 */
describe("closeTask — a second close is a no-op success (C-30)", () => {
  it("keys the echo on (thread, closed_at) and NOT on the outcome", async () => {
    await closeTask(ctx, "general", CLOSE_TASK_ID, "completed");

    const closedAt = closePatch().closed_at as string;
    expect(closedAt).toEqual(expect.any(String));
    expect(echoInsert().client_msg_id).toBe(
      closeEchoClientMsgId(CLOSE_TASK_ID, closedAt)
    );
    // THE OUTCOME IS ABSENT ON PURPOSE: the case being deduplicated is the one
    // where the two closers DISAGREE, so a key that varied with the outcome
    // would let both echoes through — the bug restated, not fixed.
    expect(echoInsert().client_msg_id).not.toContain("completed");
  });

  it("reports the STORED outcome instead of overwriting it, and writes nothing", async () => {
    // The conditional update matched no row: somebody closed it first.
    vi.mocked(repoTasks.updateTaskIfStatus).mockResolvedValue(null);
    vi.mocked(repoTasks.findTaskByChannelAndId)
      // 1. the authz read still sees the row as open
      .mockResolvedValueOnce(closableTask())
      // 2. the re-read after the lost race sees the winner's close
      .mockResolvedValue(
        closableTask({
          status: "closed",
          outcome: "completed",
          closed_at: "2026-08-08T10:00:00Z",
          outcome_summary: "They shipped it",
        })
      );

    const { thread, echoSeq } = await closeTask(
      ctx,
      "general",
      CLOSE_TASK_ID,
      // This caller wanted `failed`. The stored `completed` stands.
      "failed",
      "I think it broke"
    );

    expect(thread.status).toBe("closed");
    expect(thread.outcome).toBe("completed");
    expect(thread.outcomeSummary).toBe("They shipped it");
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    // No echo was found for the winner's key in this fixture, so no cursor is
    // fabricated. Never a guess — that is the whole `echoSeq` contract.
    expect(echoSeq).toBeNull();
  });

  it("hands a retry back the ORIGINAL echo's seq, looked up by the same key", async () => {
    vi.mocked(repoTasks.updateTaskIfStatus).mockResolvedValue(null);
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closableTask({
        status: "closed",
        outcome: "completed",
        closed_at: "2026-08-08T10:00:00Z",
      })
    );
    vi.mocked(repoMessages.findMessageByClientId).mockImplementation(
      async (_channelId, clientMsgId) =>
        clientMsgId ===
        closeEchoClientMsgId(CLOSE_TASK_ID, "2026-08-08T10:00:00Z")
          ? ({ seq: 91 } as ChannelMessageRow)
          : null
    );

    const { echoSeq } = await closeTask(
      ctx,
      "general",
      CLOSE_TASK_ID,
      "completed"
    );

    expect(echoSeq).toBe(91);
  });

  it("404s when the thread vanished between the update and the re-read", async () => {
    vi.mocked(repoTasks.updateTaskIfStatus).mockResolvedValue(null);
    vi.mocked(repoTasks.findTaskByChannelAndId)
      .mockResolvedValueOnce(closableTask())
      .mockResolvedValue(null);

    await expect(
      closeTask(ctx, "general", CLOSE_TASK_ID, "completed")
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("guards the transition in the STATEMENT, not in a preceding read", async () => {
    // The whole point of C-30's fix: `WHERE status = 'open'` is what makes
    // first-write-wins true under concurrency. A read-then-write guard would
    // pass this assertion's sibling (the read) and still lose the race.
    await closeTask(ctx, "general", CLOSE_TASK_ID, "completed");
    expect(vi.mocked(repoTasks.updateTaskIfStatus).mock.calls[0][1]).toBe("open");
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
  });
});
