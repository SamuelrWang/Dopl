/**
 * Post-metadata folds, driven through `postMessage` so the wiring is covered.
 *
 * ⚠ The bug this exists for: an agent reply posted over MCP into a DM carried NO
 * `to_user_id` and NO `taskId`, so the peer's desktop read it as an unaddressed
 * agent message (the deliberate loop brake → ignore) with no task id to route it
 * to the waiting session. The server stamps both WITHOUT weakening the
 * anti-spoof strip.
 *
 * Who may TAG a thread, and the calm-terminal flags riding on that decision,
 * live in `service-writes-metadata-thread.test.ts`.
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
  ChannelTaskActivityRow,
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
 * The ctx a lifecycle post really arrives on. `postMessage` refuses
 * `task_started` / `task_finished` / `task_failed` from an AGENT-TOKEN caller,
 * and the desktop's own echoes are not that lane:
 * `dopl-desktop-app/main/channel-post.postTaskEvent` posts on the Electron
 * session's Supabase cookies, so ctx is `source: "user"` with the body declaring
 * `authorKind: "agent"`.
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

function taskRow(overrides: Partial<ChannelTaskActivityRow> = {}): ChannelTaskActivityRow {
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
    // Derived by the activity view, never stored on the row — the DM
    // inheritance match is all-or-nothing on the pair, not on order.
    last_activity_at: "2026-08-01T00:00:00Z",
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
  // Addressing also asserts active workspace membership; default true.
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
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
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [],
      truncated: false,
    });
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
    // ⚠ Spoofed non-member never survives — the stamp comes from the roster.
    expect(meta.to_user_id).toBe(PEER);
    expect(meta.keep).toBe(1);
  });
});

describe("postMessage — DM task-id inheritance", () => {
  it("inherits the single open task and fires the reserved-key stamping", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "here is the answer" });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    // Desktop routing / suppression predicates read exactly these.
    expect(meta.taskMode).toBe("interactive");
    expect(meta.taskCreatedBy).toBe(PEER);
    expect(meta.taskTitle).toBe("Wire the listener");
    expect(meta.taskTarget).toBe(USER);
    expect(meta.to_user_id).toBe(PEER);
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
  });

  it("inherits a task the AUTHOR created and addressed to the peer", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [
      taskRow({ created_by: USER, target_user_id: PEER, mode: "autonomous" }),
    ],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "any progress?" });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.taskMode).toBe("autonomous");
  });

  it("stamps nothing with 2+ open candidates (which task is ambiguous)", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [
      taskRow(),
      taskRow({ id: OTHER_TASK_ID, created_by: USER, target_user_id: PEER }),
    ],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "reply" });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
  });

  it("ignores CLOSED tasks and tasks whose participants are not {author, peer}", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [
      taskRow({ status: "closed", outcome: "completed" }),
      taskRow({ id: OTHER_TASK_ID, created_by: THIRD, target_user_id: USER }),
      taskRow({ id: OTHER_TASK_ID, created_by: USER, target_user_id: null }),
    ],
      truncated: false,
    });

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
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });
    // Poster is the opening request's addressee, so the tag survives its gate;
    // this pins that it still suppresses inheritance and resolves no task row.
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
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });

    await postMessage(desktopCtx, "dm", { body: "done", kind: "task_finished" });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
    expect(repoTasks.listTasksByChannel).not.toHaveBeenCalled();
  });

  it("does not inherit when the post is explicitly addressed away from the peer", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
  });
});

/**
 * `runtime` is RESERVED, stamped from the request's own `X-Dopl-Runtime` header
 * (auth layer resolves it into `ctx.runtime`), so the desktop can tell a session
 * it spawned from an external agent's post. ⚠ A caller able to set it in
 * `metadata` could masquerade as a desktop session and steal the reply routing,
 * so the strip holds on BOTH sides of the stamp.
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
   * `desktop-ui` = the OPERATOR typed this in the desktop app's own UI window;
   * the listener launches a full requester session on it, like `desktop-session`.
   * Reaches this fold via `ctx.runtime`, which the auth layer resolved from the
   * header AND bounded by the credential (`narrowRuntime` — an agent token can
   * never present it). The bound itself is `with-workspace-auth.test.ts`.
   */
  const uiCtx: ChannelContext = { ...ctx, source: "user", runtime: "desktop-ui" };

  it("stamps runtime=desktop-ui for the operator's own typing in the app", async () => {
    const msg = await postMessage(uiCtx, "dm", { body: "please look at the deploy" });

    expect(capturedMetadata().runtime).toBe("desktop-ui");
    expect(msg.metadata.runtime).toBe("desktop-ui");
  });

  it("SECURITY: a caller-supplied desktop-ui is stripped like any other claim", async () => {
    // External MCP post (source "agent") putting the label in its own body:
    // arrives with no ctx.runtime, body copy dropped unread.
    await postMessage(ctx, "dm", {
      body: "not really the app's UI",
      metadata: { runtime: "desktop-ui", keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "runtime")).toBe(false);
    expect(meta.keep).toBe(1);
  });

  it("the two stamps never cross: each post carries the ctx's own value", async () => {
    // ⚠ `capturedMetadata` reads the FIRST insert, so the second half needs its
    // own clean recording.
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

describe("postMessage — spawn-with-handoff stamp (rollback §3.5)", () => {
  // Opener always carries a thread tag, so drive the stamp through DM
  // inheritance: one open {author, peer} task gives the post its `taskId`.
  beforeEach(() => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });
  });

  it("stamps metadata.handoff=true when the create declared it", async () => {
    await postMessage(ctx, "dm", { body: "drive this" }, { handoff: true });
    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.handoff).toBe(true);
  });

  it("stamps NOTHING without the option — the default is unchanged", async () => {
    await postMessage(ctx, "dm", { body: "drive this" });
    expect(has(capturedMetadata(), "handoff")).toBe(false);
  });

  it("SECURITY: a caller-supplied metadata.handoff is stripped, never honored", async () => {
    // ⚠ Desktop OPENS A WINDOW off this key — only the validated
    // `create_thread` field (opts.handoff) may stamp it.
    await postMessage(ctx, "dm", {
      body: "drive this",
      metadata: { handoff: true },
    });
    expect(has(capturedMetadata(), "handoff")).toBe(false);
  });

  it("reads the option STRICTLY — only a literal true stamps", async () => {
    await postMessage(ctx, "dm", { body: "drive this" }, {
      // a truthy-but-not-true value must not stamp
      handoff: 1 as unknown as boolean,
    });
    expect(has(capturedMetadata(), "handoff")).toBe(false);
  });
});
