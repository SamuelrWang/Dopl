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
 * The other half of that boundary — who may TAG a thread at all (both id
 * shapes) and the calm-terminal flags that ride on that decision — lives in
 * `service-writes-metadata-thread.test.ts`, split off for the §2 size cap.
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

/**
 * P0-2 (2026-08-04) — THE CTX A LIFECYCLE POST REALLY ARRIVES ON.
 *
 * `postMessage` now refuses `task_started` / `task_finished` / `task_failed` from
 * an AGENT-TOKEN caller (`source: "agent"`, i.e. every MCP `op="post"`), because
 * those three state a fact about a RUNTIME and an agent is not in a position to
 * state it. The fixtures below were written before that rule and used the agent
 * ctx for everything, including the desktop's own lifecycle echoes — which is not
 * how they arrive: `dopl-desktop-app/main/channel-post.postTaskEvent` posts on the
 * Electron session's SUPABASE COOKIES, so `buildChannelContext` resolves
 * `source: "user"` and the body declares `authorKind: "agent"`.
 *
 * So the lifecycle cases move to this ctx. That is not a workaround for the guard;
 * it makes the fixture match the lane it is describing, and it is what lets these
 * suites go on pinning what they are actually about — the legacy-tag strip and the
 * calm-flag entitlement — which are DESKTOP behaviours end to end.
 */
const desktopCtx: ChannelContext = { ...ctx, source: "user" };

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
  // Multiplayer: every thread-tagged post runs the participant-aware write
  // gate, and every thread read hydrates a participant set. No participants =
  // the pair gate, which is what these suites are about.
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoParticipants.listParticipantsByTasks).mockResolvedValue(new Map());
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
    // The poster is the opening request's addressee, so the tag survives its
    // own gate (see service-writes-metadata-thread.test.ts) — what this pins is
    // that it still suppresses inheritance and resolves no task row.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue({
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
    });

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

    await postMessage(desktopCtx, "dm", { body: "done", kind: "task_finished" });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("does not inherit when the post is explicitly addressed away from the peer", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
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

  /**
   * THE SECOND STAMP (2026-08-05, docs/CHANNELS-ROLLBACK-PLAN.md §3.4). `desktop-ui`
   * says the OPERATOR typed this in the desktop app's own UI window, and the
   * desktop's listener launches a full requester session on it — the same thing
   * `desktop-session` gets, instead of the dormant shell an unstamped post used
   * to buy. It reaches this fold exactly like its sibling: through `ctx.runtime`,
   * which the auth layer resolved from the header AND bounded by the credential
   * (`narrowRuntime` — an agent token can never present it here). This suite
   * covers the FOLD; the bound itself is `with-workspace-auth.test.ts`.
   */
  const uiCtx: ChannelContext = { ...ctx, source: "user", runtime: "desktop-ui" };

  it("stamps runtime=desktop-ui for the operator's own typing in the app", async () => {
    const msg = await postMessage(uiCtx, "dm", { body: "please look at the deploy" });

    expect(capturedMetadata().runtime).toBe("desktop-ui");
    expect(msg.metadata.runtime).toBe("desktop-ui");
  });

  it("SECURITY: a caller-supplied desktop-ui is stripped like any other claim", async () => {
    // The whole population this bound is drawn against: an external MCP post
    // (source "agent") that puts the label in its own message body. It arrives
    // with no ctx.runtime, and the body copy is dropped unread.
    await postMessage(ctx, "dm", {
      body: "not really the app's UI",
      metadata: { runtime: "desktop-ui", keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "runtime")).toBe(false);
    expect(meta.keep).toBe(1);
  });

  it("the two stamps never cross: each post carries the ctx's own value", async () => {
    // Each direction independently — `capturedMetadata` reads the FIRST insert,
    // so the second half needs its own clean recording.
    await postMessage(uiCtx, "dm", {
      body: "hi",
      metadata: { runtime: "desktop-session" },
    });
    expect(capturedMetadata().runtime).toBe("desktop-ui");

    vi.mocked(repoMessages.insertMessage).mockClear();
    await postMessage(desktopCtx, "dm", {
      body: "hi",
      metadata: { runtime: "desktop-ui" },
    });
    expect(capturedMetadata().runtime).toBe("desktop-session");
  });
});
