/**
 * Unit tests for the channels v15 write service — direct channels + tasks.
 * The repository + task repository are mocked; `service-shared` runs for real.
 * `service-reads.getChannel` is mocked (the create paths return it) so these
 * tests don't drag in the whole read hydration.
 *
 * Focus (the load-bearing new rules):
 *   - direct channels: self-DM rejected, dedup returns the existing channel,
 *     a new DM inserts exactly two members with a sorted direct_key;
 *   - task authorization: createTask (member + addressee-member), closeTask
 *     (creator OR target), setTaskMode (creator only).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-tasks");
vi.mock("./service-reads");

import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import * as reads from "./service-reads";
import { addMember, createChannel } from "./service-writes";
import { createTask, closeTask, setTaskMode } from "./service-tasks";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  ChannelInviteeNotMemberError,
  DirectChannelImmutableError,
  DirectSelfTargetError,
  TaskForbiddenError,
  TaskNotFoundError,
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
  vi.mocked(repo.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.insertMessage).mockImplementation(async (row) => ({
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
  // The create paths finish with getChannel; a stub is enough for these tests.
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );
});

describe("createChannel — direct branch", () => {
  it("rejects a self-DM (DirectSelfTargetError)", async () => {
    await expect(
      createChannel(ctx, { direct: true, memberUserId: USER })
    ).rejects.toBeInstanceOf(DirectSelfTargetError);
    expect(repo.insertChannel).not.toHaveBeenCalled();
  });

  it("rejects a peer who is not an active workspace member", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(false);
    await expect(
      createChannel(ctx, { direct: true, memberUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelInviteeNotMemberError);
    expect(repo.insertChannel).not.toHaveBeenCalled();
  });

  it("dedups: returns the existing (live) DM without inserting or reviving", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({ id: "dm-existing", is_direct: true })
    );

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.insertChannel).not.toHaveBeenCalled();
    // A live row (deleted_at null) is never revived and never re-adds members.
    expect(repo.reviveChannel).not.toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
    expect(reads.getChannel).toHaveBeenCalledWith(ctx, "dm-existing");
  });

  it("revives a soft-deleted DM (same id) and restores missing member rows", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({
        id: "dm-deleted",
        is_direct: true,
        direct_key: [USER, PEER].sort().join(":"),
        deleted_at: "2026-07-27T01:00:00Z",
      })
    );
    vi.mocked(repo.reviveChannel).mockResolvedValue(undefined);
    // Both member rows were torn down — findMembership misses for both, so each
    // is re-inserted with its original role.
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    vi.mocked(repo.insertMember).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.insertChannel).not.toHaveBeenCalled();
    expect(repo.reviveChannel).toHaveBeenCalledWith(WS, "dm-deleted");
    expect(repo.insertMember).toHaveBeenCalledTimes(2);
    const roles = vi
      .mocked(repo.insertMember)
      .mock.calls.map((c) => [c[0].user_id, c[0].role]);
    expect(roles).toContainEqual([USER, "owner"]);
    expect(roles).toContainEqual([PEER, "member"]);
    expect(reads.getChannel).toHaveBeenCalledWith(ctx, "dm-deleted");
  });

  it("revive leaves existing member rows untouched (no duplicate inserts)", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({
        id: "dm-deleted",
        is_direct: true,
        deleted_at: "2026-07-27T01:00:00Z",
      })
    );
    vi.mocked(repo.reviveChannel).mockResolvedValue(undefined);
    // Both member rows survived the soft-delete — nothing to re-insert.
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.reviveChannel).toHaveBeenCalledWith(WS, "dm-deleted");
    expect(repo.insertMember).not.toHaveBeenCalled();
  });

  it("creates a new DM with a sorted direct_key + exactly two members", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(null);
    vi.mocked(repo.existingSlugs).mockResolvedValue([]);
    vi.mocked(repo.insertChannel).mockResolvedValue(
      channelRow({ id: "dm-new", is_direct: true })
    );
    vi.mocked(repo.insertMember).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    const insertArg = vi.mocked(repo.insertChannel).mock.calls[0][0];
    expect(insertArg.is_direct).toBe(true);
    expect(insertArg.visibility).toBe("private");
    // direct_key is the two ids sorted, joined ':'.
    expect(insertArg.direct_key).toBe([USER, PEER].sort().join(":"));
    // Membership-of-2: creator (owner) + peer (member).
    expect(repo.insertMember).toHaveBeenCalledTimes(2);
    const roles = vi
      .mocked(repo.insertMember)
      .mock.calls.map((c) => [c[0].user_id, c[0].role]);
    expect(roles).toContainEqual([USER, "owner"]);
    expect(roles).toContainEqual([PEER, "member"]);
  });
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
    // USER is a member; PEER is not (default findMembership).
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

    const task = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
    });

    expect(task.createdBy).toBe(USER);
    expect(task.targetUserId).toBe(PEER);
    const insertArg = vi.mocked(repoTasks.insertTask).mock.calls[0][0];
    expect(insertArg).toMatchObject({
      workspace_id: WS,
      title: "Ship it",
      mode: "interactive",
      created_by: USER,
      target_user_id: PEER,
    });
    const msgMeta = vi.mocked(repo.insertMessage).mock.calls[0][0].metadata;
    expect(msgMeta.taskId).toBe(TASK_ID);
  });
});

describe("createTask — idempotency (client_msg_id)", () => {
  beforeEach(() => {
    // PEER is a channel member so the addressee check passes.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
  });

  it("returns the already-created task and does NOT re-insert or re-post", async () => {
    vi.mocked(repoTasks.findTaskByClientId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: PEER })
    );

    const task = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-1",
    });

    expect(repoTasks.findTaskByClientId).toHaveBeenCalledWith("chan-1", "dedupe-1");
    expect(task.id).toBe(TASK_ID);
    // No second task row and no second initial message (→ no double spawn).
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });

  it("inserts (threading client_msg_id) + posts once on the first send", async () => {
    vi.mocked(repoTasks.findTaskByClientId).mockResolvedValue(null);
    vi.mocked(repoTasks.insertTask).mockImplementation(async (row) =>
      taskRow({
        created_by: row.created_by,
        target_user_id: row.target_user_id,
        title: row.title,
      })
    );

    await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-2",
    });

    expect(vi.mocked(repoTasks.insertTask).mock.calls[0][0]).toMatchObject({
      client_msg_id: "dedupe-2",
    });
    // The initial request is posted exactly once.
    expect(repo.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("converges on the winner when the insert loses the unique race", async () => {
    vi.mocked(repoTasks.findTaskByClientId)
      .mockResolvedValueOnce(null) // pre-insert lookup misses
      .mockResolvedValueOnce(taskRow({ created_by: USER, target_user_id: PEER })); // post-race winner
    vi.mocked(repoTasks.insertTask).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");

    const task = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-3",
    });

    expect(task.id).toBe(TASK_ID);
    // The losing insert never posts — the winner's own call did.
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });
});

describe("closeTask — authorization", () => {
  it("404s an unknown task", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      closeTask(ctx, "general", TASK_ID, "completed")
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  it("allows the creator to close", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: USER, target_user_id: TARGET })
    );
    vi.mocked(repoTasks.updateTask).mockResolvedValue(
      taskRow({ status: "closed", outcome: "completed", created_by: USER })
    );

    await closeTask(ctx, "general", TASK_ID, "completed");

    expect(vi.mocked(repoTasks.updateTask).mock.calls[0][1]).toMatchObject({
      status: "closed",
      outcome: "completed",
    });
  });

  it("allows the target to close", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: CREATOR, target_user_id: USER })
    );
    vi.mocked(repoTasks.updateTask).mockResolvedValue(
      taskRow({ status: "closed", outcome: "failed" })
    );
    await expect(
      closeTask(ctx, "general", TASK_ID, "failed")
    ).resolves.toBeDefined();
  });

  it("forbids a member who is neither creator nor target", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: CREATOR, target_user_id: TARGET })
    );
    await expect(
      closeTask(ctx, "general", TASK_ID, "completed")
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
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
    // set_task_mode is realtime-invisible — it must not post a message.
    expect(repo.insertMessage).not.toHaveBeenCalled();
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

describe("addMember — direct channel is immutable", () => {
  it("rejects adding a third member to a DM (before any membership check)", async () => {
    // A DM resolves as a private, is_direct channel the caller owns.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ id: "dm-1", is_direct: true, direct_key: `${USER}:${PEER}` })
    );

    await expect(addMember(ctx, "dm-1", TARGET)).rejects.toBeInstanceOf(
      DirectChannelImmutableError
    );
    // Fails fast on the shape guard — never reaches the workspace-member or
    // insert path.
    expect(repo.isActiveWorkspaceMember).not.toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
  });
});
