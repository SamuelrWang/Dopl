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
const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
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
    favorited_at: null,
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

describe("postMessage — DM addressing is EXPLICIT (auto-address RETIRED)", () => {
  it("stamps NOTHING when a DM post carries no `to`", async () => {
    const msg = await postMessage(ctx, "dm", { body: "on it" });

    // ⚠ The FAIL-QUIET DM auto-address is gone (wiring plan Phase 3). A post
    // that names nobody reaches nobody's agent, in a DM exactly as in a group
    // channel — there is no channel shape in which the server picks an
    // addressee the caller did not.
    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
    expect(has(msg.metadata, "to_user_id")).toBe(false);
    // And it does not even ask the roster: the peer read has ONE reader left
    // (thread inheritance, below) and an unaddressed post is not it.
    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("an EXPLICIT `to` is what addresses a DM, exactly as in a group channel", async () => {
    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(capturedMetadata().to_user_id).toBe(USER);
  });

  it("leaves a NON-direct channel unaddressed (unchanged)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ is_direct: false, direct_key: null })
    );

    await postMessage(ctx, "dm", { body: "general chat" });

    expect(has(capturedMetadata(), "to_user_id")).toBe(false);
    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("SECURITY: a caller-supplied metadata to_user_id is stripped and NOT replaced", async () => {
    await postMessage(ctx, "dm", {
      body: "hello",
      metadata: { to_user_id: THIRD, keep: 1 },
    });

    const meta = capturedMetadata();
    // ⚠ The strip was never the auto-address's doing, and it outlives it: with
    // no validated `toUserId` there is nothing to re-stamp, so the spoofed id
    // simply leaves.
    expect(has(meta, "to_user_id")).toBe(false);
    expect(meta.keep).toBe(1);
  });

  it("SECURITY: a caller-supplied metadata to_user_id loses to the VALIDATED field", async () => {
    await postMessage(ctx, "dm", {
      body: "hello",
      toUserId: PEER,
      metadata: { to_user_id: THIRD, keep: 1 },
    });

    const meta = capturedMetadata();
    expect(meta.to_user_id).toBe(PEER);
    expect(meta.keep).toBe(1);
  });
});

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
    await postMessage(
      ctx,
      "dm",
      { body: "drive this", toUserId: PEER },
      { handoff: true }
    );
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
