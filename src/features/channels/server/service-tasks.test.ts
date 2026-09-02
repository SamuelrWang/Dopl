/**
 * Thread (task) lane of the channels write service. Repositories mocked;
 * `service-shared` real, `service-reads` mocked. Load-bearing rules:
 *   - authorization: createTask (member + addressee-member), setTaskMode
 *     (creator only). Close/reopen authz is
 *     `service-tasks-lifecycle.test.ts`;
 *   - ⚠ the SELF-TARGET guard — a thread addressed to its own creator has one
 *     party and can never be answered, and the guard sits IN FRONT of the
 *     `client_msg_id` short-circuit so a retry cannot be handed the dead thread
 *     back as a success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./service-reads");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as reads from "./service-reads";
import { createTask, setTaskMode } from "./service-tasks";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskSelfTargetError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const USER = "aaaaaaaa-e29b-41d4-a716-446655440000";
const PEER = "bbbbbbbb-e29b-41d4-a716-446655440000";
const CREATOR = "cccccccc-e29b-41d4-a716-446655440000";
const TARGET = "dddddddd-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
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
    created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z",
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
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-07-27T00:00:00Z",
  };
}

function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
  return {
    id: TASK_ID,
    channel_id: "chan-1",
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
  vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
    uid === USER ? memberRow(USER, "owner") : null
  );
  // createTask also asserts the addressee is an ACTIVE workspace member.
  // Defaulted true; the departed-member test flips it.
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => ({
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
    created_at: "2026-07-27T00:00:00Z",
  }));
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );
});

describe("createTask — authorization", () => {
  it("forbids a non-member (public channel, caller not a member)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(
      createTask(ctx, "general", { title: "T", body: "b", toUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
  });

  it("rejects an addressee who is not a channel member", async () => {
    await expect(
      createTask(ctx, "general", { title: "T", body: "b", toUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelAddresseeNotMemberError);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
  });

  it("C-20: rejects a target who is a channel member but a DEPARTED workspace member", async () => {
    // ⚠ `channel_members` is never swept on workspace-leave, so the target still
    // resolves as a channel member but can never answer. Must fail CLOSED, not
    // post an opening message and arm an await nothing will answer.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(false);
    await expect(
      createTask(ctx, "general", { title: "T", body: "b", toUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelAddresseeNotMemberError);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
  });

  it("creates the task + posts the initial request tagged with taskId", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repoTasks.insertTask).mockImplementation(async (row) =>
      taskRow({
        created_by: row.created_by,
        target_user_id: row.target_user_id,
        title: row.title,
        mode: row.mode,
      })
    );
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: PEER })
    );

    const { thread: task, openingSeq } = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
    });

    expect(task.createdBy).toBe(USER);
    expect(task.targetUserId).toBe(PEER);
    // ⚠ The opening message's seq rides back out — it is the requester's `await`
    // cursor, and looking it up afterwards races the peer's reply.
    expect(openingSeq).toBe(1);
    const insertArg = vi.mocked(repoTasks.insertTask).mock.calls[0][0];
    expect(insertArg).toMatchObject({
      workspace_id: WS,
      title: "Ship it",
      mode: "interactive",
      created_by: USER,
      target_user_id: PEER,
    });
    const msgMeta = vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
    expect(msgMeta.taskId).toBe(TASK_ID);
  });

  // ⚠ The opening request is what the responder's desktop routes on, so the
  // runtime stamp must reach it — only if createTask hands its own ctx down.
  it("carries the caller's runtime onto the opening request", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repoTasks.insertTask).mockImplementation(async (row) =>
      taskRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: PEER })
    );

    await createTask(
      { ...ctx, runtime: "desktop-session" },
      "general",
      { title: "Ship it", body: "please do X", toUserId: PEER }
    );

    const msgMeta = vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
    expect(msgMeta.runtime).toBe("desktop-session");
  });

  it("leaves the opening request unstamped for an external caller", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repoTasks.insertTask).mockImplementation(async (row) =>
      taskRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: PEER })
    );

    await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
    });

    const msgMeta = vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
    expect(Object.prototype.hasOwnProperty.call(msgMeta, "runtime")).toBe(false);
  });
});

describe("createTask — self-target guard", () => {
  beforeEach(() => {
    // Everyone is a channel member, so only the self-target guard catches it.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
  });

  it("rejects a thread the caller addressed to themselves, writing nothing", async () => {
    // ⚠ Only creator and target may post. Self-addressed, they are one person,
    // so the thread is accepted silently and sits dead in the panel.
    await expect(
      createTask(ctx, "general", { title: "T", body: "b", toUserId: USER })
    ).rejects.toBeInstanceOf(TaskSelfTargetError);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("still rejects on a retry whose client_msg_id matches a stored thread", async () => {
    // ⚠ ORDERING, not idempotency: the guard sits IN FRONT of the
    // client_msg_id short-circuit, so a retry errors identically instead of
    // being handed the stored dead thread as a success.
    vi.mocked(repoTasks.findOwnTaskByClientId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: USER })
    );

    await expect(
      createTask(ctx, "general", {
        title: "T",
        body: "b",
        toUserId: USER,
        clientMsgId: "dedupe-self",
      })
    ).rejects.toBeInstanceOf(TaskSelfTargetError);

    // Short-circuit never reached — no lookup, no re-driven post.
    expect(repoTasks.findOwnTaskByClientId).not.toHaveBeenCalled();
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("leaves a thread addressed to another member unaffected", async () => {
    vi.mocked(repoTasks.insertTask).mockImplementation(async (row) =>
      taskRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: PEER })
    );

    const { thread } = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
    });

    expect(thread.targetUserId).toBe(PEER);
    expect(repoTasks.insertTask).toHaveBeenCalledTimes(1);
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });
});


describe("setTaskMode — authorization", () => {
  it("allows the creator and posts NO message", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER })
    );
    vi.mocked(repoTasks.updateTask).mockResolvedValue(
      taskRow({ created_by: USER, mode: "autonomous" })
    );

    const task = await setTaskMode(ctx, "general", TASK_ID, "autonomous");

    expect(task.mode).toBe("autonomous");
    expect(vi.mocked(repoTasks.updateTask).mock.calls[0][1]).toMatchObject({
      mode: "autonomous",
    });
    // ⚠ set_task_mode is realtime-invisible — it must not post a message.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("forbids a non-creator (even the target)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: CREATOR, target_user_id: USER })
    );
    await expect(
      setTaskMode(ctx, "general", TASK_ID, "interactive")
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
  });
});
