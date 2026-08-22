/**
 * THREAD DELETION — the gate and the cascade (Samuel, 2026-08-21). Repositories
 * mocked, `service-shared` real (the membership + manage gates are the thing
 * under test). Load-bearing rules:
 *   - WHO: the thread's CREATOR, or someone who can manage the channel (owner /
 *     workspace admin). ⚠ The ADDRESSEE is refused, which is the asymmetry a
 *     future reader is most likely to "fix" — both parties may POST, only one may
 *     destroy the record;
 *   - a non-member of a PUBLIC channel is refused before any thread row loads, so
 *     the read-visibility rule never becomes a delete;
 *   - ORDER: children first, the `channel_tasks` row LAST. Nothing else in the
 *     tree pins it, and the reverse order is silently destructive — the row's
 *     departure nulls `channel_sessions.task_id` (its FK is ON DELETE SET NULL)
 *     and strands every `metadata.taskId` message on an id resolving to nothing;
 *   - consent rows are EXPIRED against the seqs the message delete actually
 *     removed, never deleted and never guessed from a range.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-collab");
vi.mock("./repository-messages");
vi.mock("./repository-sessions");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoCollab from "./repository-collab";
import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";
import * as repoTasks from "./repository-tasks";
import { deleteTask } from "./service-tasks-delete";
import {
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const CHAN = "chan-1";
const USER = "aaaaaaaa-e29b-41d4-a716-446655440000";
const CREATOR = "cccccccc-e29b-41d4-a716-446655440000";
const TARGET = "dddddddd-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

function ctxWith(overrides: Partial<ChannelContext> = {}): ChannelContext {
  return {
    workspaceId: WS,
    userId: USER,
    source: "user",
    role: "member",
    ...overrides,
  };
}

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: CHAN,
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
    created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: CHAN,
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-07-27T00:00:00Z",
  };
}

function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
  return {
    id: TASK_ID,
    channel_id: CHAN,
    workspace_id: WS,
    title: "Ship it",
    status: "open",
    outcome: null,
    mode: "interactive",
    created_by: CREATOR,
    target_user_id: TARGET,
    created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  // Plain member by default — neither creator nor manager, so each test opts in.
  vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
    uid === USER ? memberRow(USER, "member") : null
  );
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
  vi.mocked(repoMessages.deleteMessagesByThread).mockResolvedValue([]);
  vi.mocked(repoCollab.expireConsentForMessageSeqs).mockResolvedValue(undefined);
  vi.mocked(repoSessions.deleteSessionStatesForThread).mockResolvedValue(
    undefined
  );
  vi.mocked(repoTasks.deleteTaskParticipants).mockResolvedValue(undefined);
  vi.mocked(repoTasks.deleteTask).mockResolvedValue(undefined);
});

/** Nothing at all was written — the assertion every refusal case makes. */
function expectNothingDeleted() {
  expect(repoMessages.deleteMessagesByThread).not.toHaveBeenCalled();
  expect(repoSessions.deleteSessionStatesForThread).not.toHaveBeenCalled();
  expect(repoTasks.deleteTaskParticipants).not.toHaveBeenCalled();
  expect(repoTasks.deleteTask).not.toHaveBeenCalled();
}

describe("deleteTask — who may", () => {
  it("allows the thread's CREATOR, whatever their channel role", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: TARGET })
    );
    await deleteTask(ctxWith(), "general", TASK_ID);
    expect(repoTasks.deleteTask).toHaveBeenCalledWith(CHAN, TASK_ID);
  });

  it("allows the channel OWNER on somebody else's thread", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : null
    );
    await deleteTask(ctxWith(), "general", TASK_ID);
    expect(repoTasks.deleteTask).toHaveBeenCalledWith(CHAN, TASK_ID);
  });

  it("allows a WORKSPACE ADMIN who is only a plain channel member", async () => {
    await deleteTask(ctxWith({ role: "admin" }), "general", TASK_ID);
    expect(repoTasks.deleteTask).toHaveBeenCalledWith(CHAN, TASK_ID);
  });

  /**
   * ⚠ THE ASYMMETRY, PINNED. The addressee may POST in this thread
   * (`isThreadParticipant`, INVARIANTS §5) and may NOT destroy it. Anybody
   * "fixing" the gate to match the write gate lands here.
   */
  it("REFUSES the addressee, who may post in the very same thread", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: CREATOR, target_user_id: USER })
    );
    await expect(
      deleteTask(ctxWith(), "general", TASK_ID)
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expectNothingDeleted();
  });

  it("refuses a plain member who is neither party", async () => {
    await expect(
      deleteTask(ctxWith(), "general", TASK_ID)
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expectNothingDeleted();
  });

  /** A public channel's non-member CAN read a pair's thread (§5). Reading it is
   *  not standing to delete it, and the refusal precedes any thread load. */
  it("refuses a non-member of a PUBLIC channel before loading the thread", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(
      deleteTask(ctxWith(), "general", TASK_ID)
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
    expectNothingDeleted();
  });

  /** Channel-scoped load: a thread in another room reads as 404, so the id
   *  cannot be probed across channels. */
  it("404s a thread that is not in this channel", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      deleteTask(ctxWith(), "general", TASK_ID)
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    expectNothingDeleted();
  });
});

describe("deleteTask — the cascade", () => {
  beforeEach(() => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER })
    );
  });

  it("deletes CHILDREN FIRST and the thread row LAST", async () => {
    const order: string[] = [];
    vi.mocked(repoMessages.deleteMessagesByThread).mockImplementation(
      async () => {
        order.push("messages");
        return [];
      }
    );
    vi.mocked(repoSessions.deleteSessionStatesForThread).mockImplementation(
      async () => {
        order.push("sessions");
      }
    );
    vi.mocked(repoTasks.deleteTaskParticipants).mockImplementation(async () => {
      order.push("participants");
    });
    vi.mocked(repoTasks.deleteTask).mockImplementation(async () => {
      order.push("task");
    });

    await deleteTask(ctxWith(), "general", TASK_ID);

    expect(order).toEqual(["messages", "sessions", "participants", "task"]);
  });

  it("scopes every statement to the resolved channel / workspace", async () => {
    await deleteTask(ctxWith(), "general", TASK_ID);
    expect(repoMessages.deleteMessagesByThread).toHaveBeenCalledWith(
      CHAN,
      TASK_ID
    );
    expect(repoSessions.deleteSessionStatesForThread).toHaveBeenCalledWith(
      WS,
      CHAN,
      TASK_ID
    );
    expect(repoTasks.deleteTaskParticipants).toHaveBeenCalledWith(TASK_ID);
    expect(repoTasks.deleteTask).toHaveBeenCalledWith(CHAN, TASK_ID);
  });

  /** ⚠ The seqs come from the delete that actually happened — never a range and
   *  never the thread id, which the consent table does not carry. */
  it("expires consent against the seqs the message delete removed", async () => {
    vi.mocked(repoMessages.deleteMessagesByThread).mockResolvedValue([7, 9, 12]);
    await deleteTask(ctxWith(), "general", TASK_ID);
    expect(repoCollab.expireConsentForMessageSeqs).toHaveBeenCalledWith(
      CHAN,
      [7, 9, 12]
    );
  });

  /** A thread whose transcript was already gone still deletes cleanly. */
  it("still removes the thread row when no message was tagged for it", async () => {
    vi.mocked(repoMessages.deleteMessagesByThread).mockResolvedValue([]);
    await deleteTask(ctxWith(), "general", TASK_ID);
    expect(repoCollab.expireConsentForMessageSeqs).toHaveBeenCalledWith(CHAN, []);
    expect(repoTasks.deleteTask).toHaveBeenCalledWith(CHAN, TASK_ID);
  });

  /**
   * ⚠ NOT A CLOSE. Threads have no finished state (INVARIANTS §5) and nothing
   * here may start writing one — `updateTask` is the only writer of `status` /
   * `mode` and this path must never reach it.
   */
  it("writes no thread STATUS on the way out", async () => {
    await deleteTask(ctxWith(), "general", TASK_ID);
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
  });

  /** A mid-cascade failure must leave the thread row STANDING — re-clicking
   *  Delete finishes the job, and no reader sees an orphan. */
  it("leaves the thread row alone when a child step throws", async () => {
    vi.mocked(repoSessions.deleteSessionStatesForThread).mockRejectedValue(
      new Error("boom")
    );
    await expect(deleteTask(ctxWith(), "general", TASK_ID)).rejects.toThrow(
      "boom"
    );
    expect(repoTasks.deleteTask).not.toHaveBeenCalled();
  });
});
