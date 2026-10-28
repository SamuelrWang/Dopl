/**
 * `createThread`'s IDEMPOTENCY ENVELOPE (`client_msg_id`) — atomicity by
 * convergence. ⚠ The thread row and its initiating message are two writes with
 * NO transaction around them.
 *
 * ⚠ The load-bearing rule: a failed post must be REPAIRED by the retry, not
 * swallowed forever by the `client_msg_id` short-circuit, and nothing may land
 * twice — neither the thread row nor the opening request.
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
import { createThread } from "./service-threads";
import type { ChannelContext } from "./service-shared";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelThreadRow,
} from "./dto";

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
  vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  // Addressing also asserts active workspace membership; default true.
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
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

describe("createThread — idempotency (client_msg_id)", () => {
  /** The thread's own thread row, as the metadata stamping re-reads it. */
  const ownThread = () => threadRow({ created_by: USER, target_user_id: PEER });

  /** The stored initiating message, as `postMessage`'s dedup finds it. */
  function storedOpening(): ChannelMessageRow {
    return {
      id: "msg-open",
      seq: 1,
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: USER,
      author_kind: "user",
      kind: "message",
      body: "please do X",
      metadata: { threadId: THREAD_ID },
      client_msg_id: `thread-open-${THREAD_ID}`,
      created_at: "2026-07-27T00:00:00Z",
    };
  }

  beforeEach(() => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(ownThread());
  });

  it("returns the already-created thread and does NOT re-insert or re-post", async () => {
    vi.mocked(repoThreads.findOwnThreadByClientId).mockResolvedValue(ownThread());
    // ⚠ BOTH PROBES ARE THE CREATOR'S OWN — the message one since 2026-08-22, the
    // thread one since 2026-09-02. Neither is a room-wide read any more.
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(
      storedOpening()
    );

    const { thread, openingSeq } = await createThread(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-1",
    });

    expect(repoThreads.findOwnThreadByClientId).toHaveBeenCalledWith(
      "chan-1",
      USER,
      "dedupe-1"
    );
    expect(thread.id).toBe(THREAD_ID);
    // ⚠ Re-driven post dedups to the STORED opening message, so the retry
    // reports that message's seq — never a fresh one.
    expect(openingSeq).toBe(1);
    // No second thread row, no second initial message → no double spawn.
    expect(repoThreads.insertThread).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(repoMessages.findOwnMessageByClientId).toHaveBeenCalledWith(
      "chan-1",
      USER,
      `thread-open-${THREAD_ID}`
    );
  });

  it("inserts (threading client_msg_id) + posts once on the first send", async () => {
    vi.mocked(repoThreads.findOwnThreadByClientId).mockResolvedValue(null);
    vi.mocked(repoThreads.insertThread).mockImplementation(async (row) =>
      threadRow({
        created_by: row.created_by,
        target_user_id: row.target_user_id,
        title: row.title,
      })
    );

    await createThread(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-2",
    });

    expect(vi.mocked(repoThreads.insertThread).mock.calls[0][0]).toMatchObject({
      client_msg_id: "dedupe-2",
    });
    // Posted exactly once under its own derived key — that key is what makes the
    // create+post pair convergent.
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repoMessages.insertMessage).mock.calls[0][0].client_msg_id).toBe(
      `thread-open-${THREAD_ID}`
    );
  });

  it("converges on the winner when the insert loses the unique race", async () => {
    vi.mocked(repoThreads.findOwnThreadByClientId)
      .mockResolvedValueOnce(null) // pre-insert lookup misses
      .mockResolvedValueOnce(ownThread()); // post-race winner
    vi.mocked(repoThreads.insertThread).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(
      storedOpening()
    );

    const { thread } = await createThread(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-3",
    });

    expect(thread.id).toBe(THREAD_ID);
    // Loser re-drives the post; nothing lands twice.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("REGRESSION (B1): a post that fails is repaired by the retry — the request exists exactly once", async () => {
    // ⚠ No transaction around row-then-post: an insert that lands followed by a
    // post that throws leaves a thread with NO message, and the retry hits the
    // client_msg_id short-circuit and never posts — the responder's desktop has
    // nothing to route and no session spawns. The post is re-driven on the
    // short-circuit path.
    vi.mocked(repoThreads.findOwnThreadByClientId).mockResolvedValueOnce(null);
    vi.mocked(repoThreads.insertThread).mockResolvedValue(ownThread());
    vi.mocked(repoMessages.insertMessage).mockRejectedValueOnce(
      new Error("connection reset")
    );

    const send = () =>
      createThread(ctx, "general", {
        title: "Ship it",
        body: "please do X",
        toUserId: PEER,
        clientMsgId: "dedupe-4",
      });

    await expect(send()).rejects.toThrow("connection reset");
    expect(repoThreads.insertThread).toHaveBeenCalledTimes(1);

    // Retry with the SAME key: thread short-circuits, missing request is posted.
    // The stored message is still absent, so this is a real insert.
    vi.mocked(repoThreads.findOwnThreadByClientId).mockResolvedValue(ownThread());
    const { thread } = await send();

    expect(thread.id).toBe(THREAD_ID);
    // One thread row, one initiating message across both attempts.
    expect(repoThreads.insertThread).toHaveBeenCalledTimes(1);
    const posts = vi
      .mocked(repoMessages.insertMessage)
      .mock.calls.filter((c) => c[0].client_msg_id === `thread-open-${THREAD_ID}`);
    expect(posts).toHaveLength(2); // one rejected, one stored
    expect(posts[1][0].metadata.threadId).toBe(THREAD_ID);
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(
      storedOpening()
    );
    vi.mocked(repoMessages.insertMessage).mockClear();
    await send();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("another member's key is NOT a hit — the probe never sees their thread", async () => {
    // ⚠ THE C14 FIX (2026-09-02). This used to converge on the peer's thread and
    // hand it back; the probe is author-scoped now, so the peer's row is
    // invisible and the caller gets a thread of its OWN. The unique index says
    // the same (`20260913120000_channel_tasks_author_scoped_idempotency.sql`),
    // which is why a second row can be inserted at all.
    vi.mocked(repoThreads.findOwnThreadByClientId).mockResolvedValue(null);
    vi.mocked(repoThreads.insertThread).mockImplementation(async (row) =>
      threadRow({ created_by: row.created_by, target_user_id: row.target_user_id })
    );

    const { thread, openingSeq } = await createThread(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-5",
    });

    expect(repoThreads.findOwnThreadByClientId).toHaveBeenCalledWith(
      "chan-1",
      USER,
      "dedupe-5"
    );
    expect(vi.mocked(repoThreads.insertThread).mock.calls[0][0].created_by).toBe(USER);
    expect(thread.id).toBe(THREAD_ID);
    expect(openingSeq).toBe(1);
  });
});
