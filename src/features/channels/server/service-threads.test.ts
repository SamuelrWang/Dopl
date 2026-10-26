/**
 * Thread lane of the channels write service. Repositories mocked;
 * `service-shared` real, `service-reads` mocked. Load-bearing rules:
 *   - authorization: createThread (member + addressee-member), setThreadMode
 *     (creator only);
 *   - ⚠ the SELF-TARGET guard — a thread addressed to its own creator has one
 *     party and can never be answered, and the guard sits IN FRONT of the
 *     `client_msg_id` short-circuit so a retry cannot be handed the dead thread
 *     back as a success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-threads");
vi.mock("./service-reads");
// ⚠ `getChannel` MOVED TO `service-list.ts` (R-26) — the one row projection.
vi.mock("./service-list");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoThreads from "./repository-threads";
import * as list from "./service-list";
import { createThread, setThreadMode } from "./service-threads";
import {
  ChannelAddresseeNotMemberError,
  ChannelChatAddressedError,
  ChannelForbiddenError,
  ThreadForbiddenError,
  ThreadSelfTargetError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow, ChannelThreadRow } from "./dto";

const WS = "ws-1";
const USER = "aaaaaaaa-e29b-41d4-a716-446655440000";
const PEER = "bbbbbbbb-e29b-41d4-a716-446655440000";
const CREATOR = "cccccccc-e29b-41d4-a716-446655440000";
const TARGET = "dddddddd-e29b-41d4-a716-446655440000";
const THREAD_ID = "660e8400-e29b-41d4-a716-446655440111";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
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

function threadRow(overrides: Partial<ChannelThreadRow> = {}): ChannelThreadRow {
  return {
    id: THREAD_ID,
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
  // createThread also asserts the addressee is an ACTIVE workspace member.
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
  vi.mocked(list.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof list.getChannel>>
  );
});

describe("createThread — authorization", () => {
  it("forbids a non-member (public channel, caller not a member)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(
      createThread(ctx, "general", { title: "T", body: "b", toUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoThreads.insertThread).not.toHaveBeenCalled();
  });

  it("rejects an addressee who is not a channel member", async () => {
    await expect(
      createThread(ctx, "general", { title: "T", body: "b", toUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelAddresseeNotMemberError);
    expect(repoThreads.insertThread).not.toHaveBeenCalled();
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
      createThread(ctx, "general", { title: "T", body: "b", toUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelAddresseeNotMemberError);
    expect(repoThreads.insertThread).not.toHaveBeenCalled();
  });

  it("creates the thread + posts the initial request tagged with threadId", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repoThreads.insertThread).mockImplementation(async (row) =>
      threadRow({
        created_by: row.created_by,
        target_user_id: row.target_user_id,
        title: row.title,
        mode: row.mode,
      })
    );
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ created_by: USER, target_user_id: PEER })
    );

    const { thread, openingSeq } = await createThread(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
    });

    expect(thread.createdBy).toBe(USER);
    expect(thread.targetUserId).toBe(PEER);
    // ⚠ The opening message's seq rides back out — it is the requester's `await`
    // cursor, and looking it up afterwards races the peer's reply.
    expect(openingSeq).toBe(1);
    const insertArg = vi.mocked(repoThreads.insertThread).mock.calls[0][0];
    expect(insertArg).toMatchObject({
      workspace_id: WS,
      title: "Ship it",
      mode: "interactive",
      created_by: USER,
      target_user_id: PEER,
    });
    const msgMeta = vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
    expect(msgMeta.threadId).toBe(THREAD_ID);
  });

  // ⚠ The opening request is what the responder's desktop routes on, so the
  // runtime stamp must reach it — only if createThread hands its own ctx down.
  it("carries the caller's runtime onto the opening request", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repoThreads.insertThread).mockImplementation(async (row) =>
      threadRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ created_by: USER, target_user_id: PEER })
    );

    await createThread(
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
    vi.mocked(repoThreads.insertThread).mockImplementation(async (row) =>
      threadRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ created_by: USER, target_user_id: PEER })
    );

    await createThread(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
    });

    const msgMeta = vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
    expect(Object.prototype.hasOwnProperty.call(msgMeta, "runtime")).toBe(false);
  });
});

describe("createThread — self-target guard", () => {
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
      createThread(ctx, "general", { title: "T", body: "b", toUserId: USER })
    ).rejects.toBeInstanceOf(ThreadSelfTargetError);
    expect(repoThreads.insertThread).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("still rejects on a retry whose client_msg_id matches a stored thread", async () => {
    // ⚠ ORDERING, not idempotency: the guard sits IN FRONT of the
    // client_msg_id short-circuit, so a retry errors identically instead of
    // being handed the stored dead thread as a success.
    vi.mocked(repoThreads.findOwnThreadByClientId).mockResolvedValue(
      threadRow({ created_by: USER, target_user_id: USER })
    );

    await expect(
      createThread(ctx, "general", {
        title: "T",
        body: "b",
        toUserId: USER,
        clientMsgId: "dedupe-self",
      })
    ).rejects.toBeInstanceOf(ThreadSelfTargetError);

    // Short-circuit never reached — no lookup, no re-driven post.
    expect(repoThreads.findOwnThreadByClientId).not.toHaveBeenCalled();
    expect(repoThreads.insertThread).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("leaves a thread addressed to another member unaffected", async () => {
    vi.mocked(repoThreads.insertThread).mockImplementation(async (row) =>
      threadRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ created_by: USER, target_user_id: PEER })
    );

    const { thread } = await createThread(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
    });

    expect(thread.targetUserId).toBe(PEER);
    expect(repoThreads.insertThread).toHaveBeenCalledTimes(1);
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });
});


// 1.37.1: a thread needs no target. A one-member home channel could not open one
// at all, because the only addressable member was the caller.
describe("createThread — targetless thread", () => {
  beforeEach(() => {
    vi.mocked(repoThreads.insertThread).mockImplementation(async (row) =>
      threadRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );
  });

  it("opens with no target in a one-member channel, addressed to nobody", async () => {
    const { thread, openingSeq } = await createThread(ctx, "general", {
      title: "Log",
      body: "note",
    });
    expect(thread.targetUserId).toBeNull();
    expect(openingSeq).toBe(1);
    expect(vi.mocked(repoThreads.insertThread).mock.calls[0][0].target_user_id).toBeNull();
    // There is no addressee to check.
    expect(repo.isActiveWorkspaceMember).not.toHaveBeenCalled();
    const opener = vi.mocked(repoMessages.insertMessage).mock.calls[0][0];
    expect(opener.metadata.threadId).toBe(THREAD_ID);
    expect(opener.metadata.to_user_id).toBeUndefined();
  });

  it('stamps intent "chat" on the opener of a record thread', async () => {
    await createThread(ctx, "general", { title: "Log", body: "note", intent: "chat" });
    const opener = vi.mocked(repoMessages.insertMessage).mock.calls[0][0];
    expect(opener.metadata.intent).toBe("chat");
  });

  it("refuses a record thread that names a target, before writing anything", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    await expect(
      createThread(ctx, "general", { title: "T", body: "b", toUserId: PEER, intent: "chat" })
    ).rejects.toBeInstanceOf(ChannelChatAddressedError);
    expect(repoThreads.insertThread).not.toHaveBeenCalled();
  });
});

describe("setThreadMode — authorization", () => {
  it("allows the creator and posts NO message", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ created_by: USER })
    );
    vi.mocked(repoThreads.updateThread).mockResolvedValue(
      threadRow({ created_by: USER, mode: "autonomous" })
    );

    const thread = await setThreadMode(ctx, "general", THREAD_ID, "autonomous");

    expect(thread.mode).toBe("autonomous");
    expect(vi.mocked(repoThreads.updateThread).mock.calls[0][1]).toMatchObject({
      mode: "autonomous",
    });
    // ⚠ set_thread_mode is realtime-invisible — it must not post a message.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("forbids a non-creator (even the target)", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ created_by: CREATOR, target_user_id: USER })
    );
    await expect(
      setThreadMode(ctx, "general", THREAD_ID, "interactive")
    ).rejects.toBeInstanceOf(ThreadForbiddenError);
    expect(repoThreads.updateThread).not.toHaveBeenCalled();
  });
});
