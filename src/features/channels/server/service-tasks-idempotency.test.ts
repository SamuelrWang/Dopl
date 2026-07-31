/**
 * Unit tests for `createTask`'s IDEMPOTENCY ENVELOPE (`client_msg_id`) — the
 * v3.1 atomicity-by-convergence rule. Split out of `service-tasks.test.ts` (§2
 * cap) when the self-target guard was added: the thread row and its initiating
 * message are two writes with no transaction around them, and making that pair
 * converge is its own lane with its own failure modes.
 *
 * The repositories are mocked; `service-shared` runs for real. `service-reads`
 * is mocked so these tests don't drag in the whole read hydration.
 *
 * Focus (the load-bearing rule): a failed post must be REPAIRED by the retry
 * instead of being swallowed forever by the `client_msg_id` short-circuit, and
 * nothing may land twice — not the thread row, not the opening request.
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
import { createTask } from "./service-tasks";
import type { ChannelContext } from "./service-shared";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";

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
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
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
  // The create paths finish with getChannel; a stub is enough for these tests.
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );
});

describe("createTask — idempotency (client_msg_id)", () => {
  /** The task's own thread row, as the metadata stamping re-reads it. */
  const ownTask = () => taskRow({ created_by: USER, target_user_id: PEER });

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
      metadata: { taskId: TASK_ID },
      client_msg_id: `task-open-${TASK_ID}`,
      created_at: "2026-07-27T00:00:00Z",
    };
  }

  beforeEach(() => {
    // PEER is a channel member so the addressee check passes.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid)
    );
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(ownTask());
  });

  it("returns the already-created task and does NOT re-insert or re-post", async () => {
    vi.mocked(repoTasks.findTaskByClientId).mockResolvedValue(ownTask());
    // The initiating message already landed on the first send.
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      storedOpening()
    );

    const { thread: task, openingSeq } = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-1",
    });

    expect(repoTasks.findTaskByClientId).toHaveBeenCalledWith("chan-1", "dedupe-1");
    expect(task.id).toBe(TASK_ID);
    // The re-driven post dedups to the STORED opening message, so the retry
    // reports that message's seq — never a fresh one.
    expect(openingSeq).toBe(1);
    // No second task row and no second initial message (→ no double spawn).
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(repoMessages.findMessageByClientId).toHaveBeenCalledWith(
      "chan-1",
      `task-open-${TASK_ID}`
    );
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
    // The initial request is posted exactly once, under its own derived key —
    // that key is what makes the create+post pair convergent.
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repoMessages.insertMessage).mock.calls[0][0].client_msg_id).toBe(
      `task-open-${TASK_ID}`
    );
  });

  it("converges on the winner when the insert loses the unique race", async () => {
    vi.mocked(repoTasks.findTaskByClientId)
      .mockResolvedValueOnce(null) // pre-insert lookup misses
      .mockResolvedValueOnce(ownTask()); // post-race winner
    vi.mocked(repoTasks.insertTask).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
    // The winner already posted the request under the derived key.
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      storedOpening()
    );

    const { thread: task } = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-3",
    });

    expect(task.id).toBe(TASK_ID);
    // The loser re-drives the post but nothing lands twice.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("REGRESSION (B1): a post that fails is repaired by the retry — the request exists exactly once", async () => {
    // The row-then-post pair has no transaction around it. Before the fix, an
    // insert that landed followed by a post that threw left a thread with NO
    // message: the retry hit the client_msg_id short-circuit, returned the
    // stored task and never posted, so the responder's desktop had nothing to
    // route and no session ever spawned (there is a live example of this in
    // prod). Now the initiating post is re-driven on the short-circuit path.
    vi.mocked(repoTasks.findTaskByClientId).mockResolvedValueOnce(null);
    vi.mocked(repoTasks.insertTask).mockResolvedValue(ownTask());
    vi.mocked(repoMessages.insertMessage).mockRejectedValueOnce(
      new Error("connection reset")
    );

    const send = () =>
      createTask(ctx, "general", {
        title: "Ship it",
        body: "please do X",
        toUserId: PEER,
        clientMsgId: "dedupe-4",
      });

    // First send: the thread row lands, the request post blows up.
    await expect(send()).rejects.toThrow("connection reset");
    expect(repoTasks.insertTask).toHaveBeenCalledTimes(1);

    // Retry with the SAME key: the task short-circuits, the missing request is
    // posted. The stored message is still absent, so this is a real insert.
    vi.mocked(repoTasks.findTaskByClientId).mockResolvedValue(ownTask());
    const { thread: task } = await send();

    expect(task.id).toBe(TASK_ID);
    // Exactly one task row, and exactly one initiating message across both
    // attempts (the failed one never landed).
    expect(repoTasks.insertTask).toHaveBeenCalledTimes(1);
    const posts = vi
      .mocked(repoMessages.insertMessage)
      .mock.calls.filter((c) => c[0].client_msg_id === `task-open-${TASK_ID}`);
    expect(posts).toHaveLength(2); // one rejected, one stored
    expect(posts[1][0].metadata.taskId).toBe(TASK_ID);
    // A third send finds the stored message and inserts nothing more.
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      storedOpening()
    );
    vi.mocked(repoMessages.insertMessage).mockClear();
    await send();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("does not post into a thread the colliding key belongs to someone else", async () => {
    // A client_msg_id collision from another member returns their task (the
    // pre-existing dedup), but must not put a message into their thread.
    vi.mocked(repoTasks.findTaskByClientId).mockResolvedValue(
      taskRow({ created_by: PEER, target_user_id: PEER })
    );

    const { openingSeq } = await createTask(ctx, "general", {
      title: "Ship it",
      body: "please do X",
      toUserId: PEER,
      clientMsgId: "dedupe-5",
    });

    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    // No post happened, so there is no cursor to report — null, never a guess.
    expect(openingSeq).toBeNull();
  });
});
