/**
 * Unit tests for the post-metadata folds — driven through `postMessage` so the
 * wiring is covered too. The repository + task repository are mocked.
 *
 * Focus: the delivery bug this file exists for. An agent reply posted over MCP
 * into a DM carried NO `to_user_id` and NO `taskId`, so the peer's desktop read
 * it as an unaddressed agent message (the deliberate loop brake → ignore) and
 * had no task id to route it to the waiting session. The server now stamps
 * both, and it must do so WITHOUT weakening the anti-spoof strip.
 *
 * And the second half of that boundary: the calm-terminal flags
 * (declined/dropped/interrupted/capped/ended) decide how the OTHER side's card
 * reads, so they are stamped only for the thread's own participants.
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
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const TASK_ID = "44444444-e29b-41d4-a716-446655440000";
const OTHER_TASK_ID = "55555555-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
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
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
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
    joined_at: "2026-07-29T00:00:00Z",
  };
}

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
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 98,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-29T00:00:00Z",
  };
}

/** The metadata object handed to `repoMessages.insertMessage`. */
function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
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
});

describe("postMessage — DM auto-address", () => {
  it("stamps the peer as to_user_id when a DM post carries no `to`", async () => {
    const msg = await postMessage(ctx, "dm", { body: "on it" });

    expect(capturedMetadata().to_user_id).toBe(PEER);
    expect(msg.metadata.to_user_id).toBe(PEER);
  });

  it("an explicit `to` is never overridden by the auto-address", async () => {
    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(capturedMetadata().to_user_id).toBe(USER);
  });

  it("leaves a NON-direct channel unaddressed (3+ members are ambiguous)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ is_direct: false, direct_key: null })
    );

    await postMessage(ctx, "dm", { body: "general chat" });

    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("stamps nothing (and still posts) when the DM peer cannot be resolved", async () => {
    // A torn-down roster: only the author's own membership survives.
    vi.mocked(repo.listMembers).mockResolvedValue([memberRow(USER, "owner")]);

    await postMessage(ctx, "dm", { body: "hello" });

    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
  });

  it("stamps nothing when a would-be third member makes the peer ambiguous", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "owner"),
      memberRow(PEER),
      memberRow(THIRD),
    ]);

    await postMessage(ctx, "dm", { body: "hello" });

    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
  });

  it("SECURITY: a caller-supplied metadata to_user_id is still stripped, then replaced by the validated peer", async () => {
    await postMessage(ctx, "dm", {
      body: "hello",
      metadata: { to_user_id: THIRD, keep: 1 },
    });

    const meta = capturedMetadata();
    // The spoofed non-member never survives; the stamp comes from the roster.
    expect(meta.to_user_id).toBe(PEER);
    expect(meta.keep).toBe(1);
  });
});

describe("postMessage — DM task-id inheritance", () => {
  it("inherits the single open task and fires the reserved-key stamping", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "here is the answer" });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    // The desktop's routing / suppression predicates read exactly these.
    expect(meta.taskMode).toBe("interactive");
    expect(meta.taskCreatedBy).toBe(PEER);
    expect(meta.taskTitle).toBe("Wire the listener");
    expect(meta.taskTarget).toBe(USER);
    expect(meta.to_user_id).toBe(PEER);
    // Inheritance resolves off the channel's task list — no second lookup.
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
  });

  it("inherits a task the AUTHOR created and addressed to the peer", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow({ created_by: USER, target_user_id: PEER, mode: "autonomous" }),
    ]);

    await postMessage(ctx, "dm", { body: "any progress?" });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.taskMode).toBe("autonomous");
  });

  it("stamps nothing with 2+ open candidates (which task is ambiguous)", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow(),
      taskRow({ id: OTHER_TASK_ID, created_by: USER, target_user_id: PEER }),
    ]);

    await postMessage(ctx, "dm", { body: "reply" });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
  });

  it("ignores CLOSED tasks and tasks whose participants are not {author, peer}", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([
      taskRow({ status: "closed", outcome: "completed" }),
      taskRow({ id: OTHER_TASK_ID, created_by: THIRD, target_user_id: USER }),
      taskRow({ id: OTHER_TASK_ID, created_by: USER, target_user_id: null }),
    ]);

    await postMessage(ctx, "dm", { body: "reply" });

    const meta = capturedMetadata();
    expect(has(meta, "taskId")).toBe(false);
    expect(has(meta, "taskMode")).toBe(false);
  });

  it("a caller-supplied taskId suppresses inheritance (explicit threading wins)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ id: OTHER_TASK_ID, title: "Explicit" })
    );

    await postMessage(ctx, "dm", {
      body: "reply",
      metadata: { taskId: OTHER_TASK_ID },
    });

    expect(capturedMetadata().taskId).toBe(OTHER_TASK_ID);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("a legacy task-<uuid>-<seq> id suppresses inheritance and stamps nothing", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", {
      body: "reply",
      metadata: { taskId: "task-chan-1-7" },
    });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe("task-chan-1-7");
    expect(has(meta, "taskMode")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("never inherits in a NON-direct channel", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ is_direct: false, direct_key: null })
    );

    await postMessage(ctx, "dm", { body: "reply", toUserId: PEER });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("never inherits onto a lifecycle event (a marker must not land on someone else's task)", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "done", kind: "task_finished" });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("does not inherit when the post is explicitly addressed away from the peer", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
  });
});

describe("postMessage — calm-terminal flags (anti-spoof)", () => {
  /** A legacy `task-{channelId}-{seq}` id — the shape the desktop still posts. */
  const LEGACY_ID = "task-chan-1-7";

  /** The legacy exchange's opening request at seq 7. */
  function opener(overrides: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
    return {
      id: "msg-open",
      seq: 7,
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: PEER,
      author_kind: "user",
      kind: "message",
      body: "please do X",
      metadata: { to_user_id: USER },
      client_msg_id: null,
      created_at: "2026-07-29T00:00:00Z",
      ...overrides,
    };
  }

  it("stamps the flag for a participant of a LEGACY exchange (the desktop's decline echo)", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(opener());

    await postMessage(ctx, "dm", {
      body: "Request declined",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, declined: true },
    });

    expect(capturedMetadata().declined).toBe(true);
    expect(repoMessages.findMessageBySeq).toHaveBeenCalledWith("chan-1", 7);
  });

  it("stamps the flag for the AUTHOR of the legacy opening request", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: USER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(ctx, "dm", {
      body: "Session ended",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, ended: true },
    });

    expect(capturedMetadata().ended).toBe(true);
  });

  it("SECURITY: strips the flag when the legacy exchange belongs to two OTHER people", async () => {
    // The spoof: a third member of the channel stamps someone else's exchange
    // id with `declined: true`, and their card renders "This request was
    // declined." for work that was never declined.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(ctx, "dm", {
      body: "Request declined",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, declined: true, dropped: true },
    });

    const meta = capturedMetadata();
    // Stripped, but the message itself still posts (visible, attributable).
    expect(has(meta, "declined")).toBe(false);
    expect(has(meta, "dropped")).toBe(false);
    expect(meta.taskId).toBe(LEGACY_ID);
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("SECURITY: fails closed when the legacy opener cannot be resolved", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(null);

    await postMessage(ctx, "dm", {
      body: "Request interrupted",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, interrupted: true },
    });

    expect(has(capturedMetadata(), "interrupted")).toBe(false);
  });

  it("stamps the flag on a FIRST-CLASS thread the poster participates in", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());

    await postMessage(ctx, "dm", {
      body: "Turn limit reached",
      kind: "task_failed",
      metadata: { taskId: TASK_ID, capped: true },
    });

    const meta = capturedMetadata();
    expect(meta.capped).toBe(true);
    expect(meta.taskTitle).toBe("Wire the listener");
    // A first-class id the poster does NOT participate in never gets this far —
    // the post is refused (see service-writes.test.ts).
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("strips a truthy-but-not-true flag even from a participant", async () => {
    // The renderers read `=== true`; normalizing here keeps the stored wire
    // clean instead of relying on every reader staying strict.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(opener());

    await postMessage(ctx, "dm", {
      body: "Crashed",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, capped: "true", ended: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "capped")).toBe(false);
    expect(has(meta, "ended")).toBe(false);
  });

  it("strips flags on a post with no thread id at all", async () => {
    await postMessage(ctx, "dm", {
      body: "not a real outcome",
      kind: "task_failed",
      metadata: { declined: true },
    });

    expect(has(capturedMetadata(), "declined")).toBe(false);
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });
});

/**
 * WAKE-V1 — `runtime` is a RESERVED key stamped from the request's own
 * `X-Dopl-Runtime` header (resolved into `ctx.runtime` by the auth layer), so
 * the desktop can tell a session it spawned from an external agent's post. A
 * caller that could set it in `metadata` could make an external post
 * masquerade as a desktop session and steal the reply routing, so the strip
 * has to hold on BOTH sides of the stamp.
 */
describe("postMessage — runtime stamp (WAKE-V1)", () => {
  const desktopCtx: ChannelContext = { ...ctx, runtime: "desktop-session" };

  it("stamps runtime=desktop-session when the request carried the header", async () => {
    const msg = await postMessage(desktopCtx, "dm", { body: "on it" });

    expect(capturedMetadata().runtime).toBe("desktop-session");
    expect(msg.metadata.runtime).toBe("desktop-session");
  });

  it("stamps NO runtime key when the header is absent (an external agent)", async () => {
    await postMessage(ctx, "dm", { body: "on it" });

    expect(has(capturedMetadata(), "runtime")).toBe(false);
  });

  it("SECURITY: a caller-supplied metadata.runtime is stripped, header or not", async () => {
    await postMessage(ctx, "dm", {
      body: "not really a desktop session",
      metadata: { runtime: "desktop-session", keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "runtime")).toBe(false);
    // Only the reserved key is taken — unrelated caller metadata survives.
    expect(meta.keep).toBe(1);
  });

  it("SECURITY: a spoofed value never survives a real desktop session either", async () => {
    await postMessage(desktopCtx, "dm", {
      body: "hi",
      metadata: { runtime: "external-agent" },
    });

    expect(capturedMetadata().runtime).toBe("desktop-session");
  });

});
