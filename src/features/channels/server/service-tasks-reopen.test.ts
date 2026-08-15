/**
 * REOPEN half of `service-tasks-lifecycle.ts` — the echo that makes a reopen
 * VISIBLE to the other member, its marker, idempotency key,
 * degrade-don't-throw contract, and the already-open no-op.
 *
 * ⚠ Why an echo exists: `channel_tasks` is in NEITHER realtime table set
 * (`constants.ts` `CHANNEL_TABLES`, `main/ui-sync.js` `SYNC_TABLES`), so a
 * status change reaches no peer surface by itself. The fix is the echo, not
 * publishing the table.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { reopenEchoClientMsgId, reopenTask } from "./service-tasks-lifecycle";
import { TaskForbiddenError, TaskNotFoundError } from "./errors";
import { REOPEN_MARKER_KEY } from "./service-writes-metadata-markers";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const OTHER = "990e8400-e29b-41d4-a716-446655440999";
const TASK_ID = "770e8400-e29b-41d4-a716-446655440222";
const CLOSED_AT = "2026-08-07T09:00:00Z";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

/** The AGENT lane. Reopen has no `source` check and the PATCH route is not
 *  `sessionOnly`, so an agent token reaches it — by design. */
const agentCtx: ChannelContext = {
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

/** A CLOSED task with a stored outcome + summary, ready to be reopened. */
function closedTask(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
  return {
    id: TASK_ID,
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
    closed_at: CLOSED_AT,
    outcome_summary: "Shipped v2",
    ...overrides,
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 55,
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

/** The echo `postMessage` wrote (the only insertMessage call). */
function echoInsert() {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0];
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
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(closedTask());
  // The conditional update, then the row `postMessage` re-resolves for the
  // thread stamp — both come back OPEN.
  vi.mocked(repoTasks.updateTaskIfStatus).mockImplementation(
    async (_id, _status, patch) => closedTask({ ...patch } as Partial<ChannelTaskRow>)
  );
});

describe("reopenTask — authorization", () => {
  it("404s an unknown task (nothing updated)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      reopenTask(ctx, "general", TASK_ID)
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    expect(repoTasks.updateTaskIfStatus).not.toHaveBeenCalled();
  });

  it("forbids a member who is neither creator nor target", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ created_by: OTHER, target_user_id: OTHER })
    );
    await expect(
      reopenTask(ctx, "general", TASK_ID)
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expect(repoTasks.updateTaskIfStatus).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("creator reopen clears the closed state in one CHECK-satisfying update", async () => {
    const { thread } = await reopenTask(ctx, "general", TASK_ID);

    // ⚠ outcome / closed_at / outcome_summary all nulled, keeping
    // (status='closed') = (outcome IS NOT NULL) satisfied.
    expect(vi.mocked(repoTasks.updateTaskIfStatus).mock.calls[0][2]).toEqual({
      status: "open",
      outcome: null,
      closed_at: null,
      outcome_summary: null,
    });
    // ⚠ Transition guarded in the STATEMENT, not by a preceding read.
    expect(vi.mocked(repoTasks.updateTaskIfStatus).mock.calls[0][1]).toBe("closed");
    expect(thread.status).toBe("open");
    expect(thread.outcome).toBeNull();
  });

  it("the target may also reopen", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ created_by: OTHER, target_user_id: USER })
    );
    await expect(reopenTask(ctx, "general", TASK_ID)).resolves.toBeDefined();
    expect(repoTasks.updateTaskIfStatus).toHaveBeenCalledTimes(1);
  });
});

/** The echo itself. Every assertion is a property the peer's screen depends
 *  on, so each is stated rather than implied. */
describe("reopenTask — the lifecycle echo (C-26)", () => {
  it("posts a NON-TERMINAL task_progress carrying the reopen marker", async () => {
    const { echoSeq } = await reopenTask(ctx, "general", TASK_ID);

    const echo = echoInsert();
    // ⚠ NOT a lifecycle kind: `groupThread` folds task_finished/task_failed into
    // `draft.endEvent` and reads that as the OUTCOME. `task_progress` is an entry
    // by construction and renders in the milestones lane on any client.
    expect(echo.kind).toBe("task_progress");
    // ⚠ NOT task_started either — it takes over the card's header identity
    // (`draft.head`) and opens groupThread's fallback window.
    expect(echo.kind).not.toBe("task_started");
    expect(echo.metadata).toMatchObject({
      taskId: TASK_ID,
      [REOPEN_MARKER_KEY]: true,
    });
    // A marker, not an outcome — no close/proposal keys ride along.
    expect(echo.metadata).not.toHaveProperty("closeProposed");
    expect(echoSeq).toBe(55);
  });

  it("names the outcome it undid, because the reopen erases it from the row", async () => {
    await reopenTask(ctx, "general", TASK_ID);
    expect(echoInsert().body).toBe("Thread reopened (was closed as completed).");
  });

  it("falls back to a bare body when the closed row carried no outcome", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ outcome: null })
    );
    await reopenTask(ctx, "general", TASK_ID);
    expect(echoInsert().body).toBe("Thread reopened.");
  });

  it("carries the thread title as the echo's summary", async () => {
    await reopenTask(ctx, "general", TASK_ID);
    expect(echoInsert().metadata).toMatchObject({ summary: "Ship it" });
  });

  it("the MARKER IS RESERVED — a caller cannot forge it on an ordinary post", async () => {
    // `resolvePostMetadata` strips the key unconditionally and re-stamps only
    // from the server-internal option. Proven through the real fold.
    const { postMessage } = await import("./service-writes");
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ status: "open", outcome: null, closed_at: null })
    );

    const posted = await postMessage(ctx, "general", {
      body: "this thread is live again, honest",
      metadata: { taskId: TASK_ID, [REOPEN_MARKER_KEY]: true },
    });

    expect(posted.metadata).not.toHaveProperty(REOPEN_MARKER_KEY);
  });
});

/** ⚠ The echo's failure is NOT the reopen's failure — the state change has
 *  already committed by the time the marker is written. */
describe("reopenTask — an echo failure degrades, never throws", () => {
  it("still reopens, with a NULL seq, when only the echo post fails", async () => {
    vi.mocked(repoMessages.insertMessage).mockRejectedValue(
      new Error("transient insert failure")
    );

    const { thread, echoSeq } = await reopenTask(ctx, "general", TASK_ID);

    expect(echoSeq).toBeNull();
    expect(thread.status).toBe("open");
    expect(vi.mocked(repoTasks.updateTaskIfStatus).mock.calls[0][2]).toMatchObject({
      status: "open",
      outcome: null,
    });
  });

  it("does not swallow the reopen's OWN errors (authz is unchanged)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ created_by: OTHER, target_user_id: OTHER })
    );
    await expect(
      reopenTask(ctx, "general", TASK_ID)
    ).rejects.toBeInstanceOf(TaskForbiddenError);
  });
});

/**
 * Idempotency. A reopen keys on the `closed_at` of the close it reverses. ⚠ A
 * message-seq anchor MOVES the moment the echo lands, which is exactly how a
 * retry posts a second one.
 */
describe("reopenTask — the echo cannot post twice", () => {
  it("keys the echo on the closed_at it is undoing", async () => {
    await reopenTask(ctx, "general", TASK_ID);
    expect(echoInsert().client_msg_id).toBe(
      reopenEchoClientMsgId(TASK_ID, CLOSED_AT)
    );
  });

  it("a RETRY writes nothing at all — the row is already open", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ status: "open", outcome: null, closed_at: null, outcome_summary: null })
    );

    const { thread, echoSeq } = await reopenTask(ctx, "general", TASK_ID);

    expect(repoTasks.updateTaskIfStatus).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(thread.status).toBe("open");
    // This call wrote nothing, and the anchor naming the original echo was
    // erased by the reopen that already succeeded.
    expect(echoSeq).toBeNull();
  });

  it("a CONCURRENT loser posts nothing and returns the winner's echo seq", async () => {
    vi.mocked(repoTasks.updateTaskIfStatus).mockResolvedValue(null);
    vi.mocked(repoTasks.findTaskByChannelAndId)
      // 1. authz read: still closed, so this caller computes the same anchor
      .mockResolvedValueOnce(closedTask())
      // 2. re-read after losing the race: the winner's open row
      .mockResolvedValue(closedTask({ status: "open", outcome: null, closed_at: null }));
    vi.mocked(repoMessages.findMessageByClientId).mockImplementation(
      async (_channelId, clientMsgId) =>
        clientMsgId === reopenEchoClientMsgId(TASK_ID, CLOSED_AT)
          ? ({ seq: 61 } as ChannelMessageRow)
          : null
    );

    const { thread, echoSeq } = await reopenTask(ctx, "general", TASK_ID);

    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(thread.status).toBe("open");
    expect(echoSeq).toBe(61);
  });

  it("a LATER reopen of a DIFFERENT close gets a different key", async () => {
    // close → reopen → work → close → reopen. The second close stamped a new
    // `closed_at`, so the second reopen is a new statement, not a replay — the
    // half a "one-shot forever" key breaks.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      closedTask({ closed_at: "2026-08-09T18:30:00Z", outcome: "failed" })
    );

    await reopenTask(ctx, "general", TASK_ID);

    expect(echoInsert().client_msg_id).toBe(
      reopenEchoClientMsgId(TASK_ID, "2026-08-09T18:30:00Z")
    );
    expect(echoInsert().client_msg_id).not.toBe(
      reopenEchoClientMsgId(TASK_ID, CLOSED_AT)
    );
    expect(echoInsert().body).toBe("Thread reopened (was closed as failed).");
  });
});

/** Reopen is agent-reachable by design. `task_progress` is not in
 *  `LIFECYCLE_KINDS`, so the guard passes it with NO `internalLifecycle`
 *  exemption and the transcript attributes it to the agent. */
describe("reopenTask — an AGENT-triggered reopen echoes correctly", () => {
  it("posts the same marker, attributed to the agent, with no exemption asked for", async () => {
    const { echoSeq } = await reopenTask(agentCtx, "general", TASK_ID);

    const echo = echoInsert();
    expect(echo.kind).toBe("task_progress");
    expect(echo.author_kind).toBe("agent");
    expect(echo.metadata).toMatchObject({ [REOPEN_MARKER_KEY]: true });
    expect(echoSeq).toBe(55);
  });
});
