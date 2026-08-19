/**
 * THE FAN-OUT GROUP STAMP — the reserved key that lets N threads of one request
 * render as ONE card.
 *
 * ⚠ ITS OWN FILE, and the reason is the reason the key is reserved at all: the
 * transcript groups every opening message sharing a `fanoutGroup`, so a
 * caller-settable value would draw one member's thread inside another member's
 * request. That is a security property, and it belongs somewhere a reader can
 * find it by name rather than fifteen describes down the metadata fold's file
 * (which was also over the 500-line cap once this landed).
 *
 * The harness is deliberately a COPY of `service-writes-metadata.test.ts`'s:
 * these tests drive the real `postMessage`, and a shared fixture module would
 * be one more thing to keep in step with a fold that changes for many reasons.
 */

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
const TASK_ID = "44444444-e29b-41d4-a716-446655440000";
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

describe("postMessage — fan-out group stamp (wiring plan Phase 3)", () => {
  // Same device as the handoff stamp: drive it through DM inheritance so the
  // post carries a thread tag the poster is entitled to.
  beforeEach(() => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });
  });

  it("stamps metadata.fanoutGroup from the server-derived option", async () => {
    await postMessage(
      ctx,
      "dm",
      { body: "start here", toUserId: PEER },
      { fanoutGroupId: "grp-1" }
    );
    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.fanoutGroup).toBe("grp-1");
  });

  it("stamps NOTHING without the option", async () => {
    await postMessage(ctx, "dm", { body: "start here", toUserId: PEER });
    expect(has(capturedMetadata(), "fanoutGroup")).toBe(false);
  });

  it("SECURITY: a caller-supplied metadata.fanoutGroup is stripped, never honored", async () => {
    // ⚠ The transcript renders every opening message sharing a group as ONE
    // card, so a settable group id is a way to render your own thread inside
    // somebody else's request.
    await postMessage(ctx, "dm", {
      body: "start here",
      toUserId: PEER,
      metadata: { fanoutGroup: "somebody-elses-card" },
    });
    expect(has(capturedMetadata(), "fanoutGroup")).toBe(false);
  });

  it("drops the group with the tag when the thread tag does not survive", async () => {
    // No inheritable thread, so no `taskId` — and a group with nothing to hang
    // off is a group on a loose message.
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [],
      truncated: false,
    });

    await postMessage(
      ctx,
      "dm",
      { body: "start here", toUserId: PEER },
      { fanoutGroupId: "grp-1" }
    );
    expect(has(capturedMetadata(), "fanoutGroup")).toBe(false);
  });
});
