/**
 * Lifecycle kinds are not an agent's to post — the AUTHORITATIVE half, holding
 * for anything posting straight at `/api/channels/[id]/messages` with a device
 * token. (`channel-ops-write.ts` refuses earlier for MCP callers.)
 *
 * ⚠ THE SEAM IS THE CREDENTIAL, not who the message says wrote it. Too wide and
 * the desktop runtime's own echoes stop (`main/session-window.js` posts on
 * Electron's Supabase cookies, so `source:"user"`); too narrow and an agent's
 * answer posted as `task_finished` renders nowhere (`lib/group-thread.ts` folds
 * terminal markers into `draft.endEvent`, never `draft.entries`). Asserted in
 * both directions.
 *
 * ⚠ REWRITTEN DOWN 2026-08-18 (wiring plan Phase 4). It also held the
 * propose-then-confirm contract — `closeTask` refusing an agent token,
 * `proposeTaskClose`'s idempotency anchor, the reserved close-proposal keys —
 * and every one of those services is deleted. What is here is the lifecycle-kind
 * guard, which is untouched by that removal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { ChannelLifecycleKindForbiddenError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const PEER = "user-2";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

/**
 * The two lanes. `agentCtx` = bearer agent token (every MCP `op="post"`);
 * `desktopCtx` = cookie caller (desktop listener + web), the lane that
 * legitimately writes lifecycle markers.
 */
const agentCtx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};
const desktopCtx: ChannelContext = { ...agentCtx, source: "user" };

const LIFECYCLE_KINDS = ["task_started", "task_finished", "task_failed"] as const;

function channelRow(): ChannelRow {
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
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "owner",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
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
    created_by: USER,
    target_user_id: PEER,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
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
    seq: 42,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-20T00:00:00Z",
  };
}

/** The one insert a call made, or undefined when it wrote nothing. */
function inserted() {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER));
  vi.mocked(repo.listMembers).mockResolvedValue([memberRow(USER), memberRow(PEER)]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => insertedRow(row));
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [],
      truncated: false,
    });
  vi.mocked(repoTasks.updateTask).mockImplementation(async (_id, patch) =>
    taskRow({ ...patch })
  );
});

// ── 1. the refusal ─────────────────────────────────────────────────────────────

describe("postMessage — an AGENT TOKEN cannot post a lifecycle kind", () => {
  it.each(LIFECYCLE_KINDS)("refuses %s and writes nothing at all", async (kind) => {
    await expect(
      postMessage(agentCtx, "general", { body: "Here is the finished analysis…", kind })
    ).rejects.toBeInstanceOf(ChannelLifecycleKindForbiddenError);
    // ⚠ Nothing was SENT, not merely reported — the failure mode is an agent
    // believing it delivered.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("names the kind and says where the prose goes instead", async () => {
    const err: Error = await postMessage(agentCtx, "general", {
      body: "done",
      kind: "task_finished",
    }).then(
      () => new Error("the post was NOT refused"),
      (e: Error) => e
    );
    expect(err.message).toContain("task_finished");
    expect(err.message).toContain("Post your message with no kind");
    expect(err.message).toContain("task_progress");
  });

  it("refuses BEFORE the idempotency short-circuit, so a retry cannot replay it", async () => {
    // ⚠ If the guard sat AFTER, a refused caller could re-send the same
    // client_msg_id, hit `findMessageByClientId`, and be handed a stored message
    // back as if the post succeeded.
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      insertedRow({
        channel_id: "chan-1",
        workspace_id: WS,
        author_user_id: USER,
        author_kind: "agent",
        kind: "task_finished",
        body: "done",
        metadata: {},
        client_msg_id: "k1",
      })
    );
    await expect(
      postMessage(agentCtx, "general", {
        body: "done",
        kind: "task_finished",
        clientMsgId: "k1",
      })
    ).rejects.toBeInstanceOf(ChannelLifecycleKindForbiddenError);
    expect(repoMessages.findMessageByClientId).not.toHaveBeenCalled();
  });
});

// ── 2. what must keep working ──────────────────────────────────────────────────

describe("postMessage — the lanes the guard must NOT touch", () => {
  it("task_progress stays agent-writable: it is the milestone lane", async () => {
    // Only `task_*` kind whose body IS rendered (`splitSessionEntries`) and the
    // only one claiming nothing about lifecycle.
    const msg = await postMessage(agentCtx, "general", {
      body: "schema half landed",
      kind: "task_progress",
    });
    expect(msg.kind).toBe("task_progress");
    expect(inserted()?.kind).toBe("task_progress");
  });

  it("a plain message from an agent is untouched (the whole point of the rule)", async () => {
    const msg = await postMessage(agentCtx, "general", { body: "Here is the answer." });
    expect(msg.kind).toBe("message");
  });

  it.each(LIFECYCLE_KINDS)(
    "the DESKTOP RUNTIME still posts %s on its cookie session",
    async (kind) => {
      // `main/session-window.js` onLaunched/onEnded → `channel-post.postTaskEvent`
      // → `listener-io.apiFetch`, on the Electron session's Supabase cookies.
      const msg = await postMessage(desktopCtx, "general", {
        body: "Started working on this request.",
        kind,
        authorKind: "agent",
      });
      expect(msg.kind).toBe(kind);
      // ⚠ Still an AGENT-authored row — the guard is about the CREDENTIAL.
      expect(inserted()?.author_kind).toBe("agent");
    }
  );

  // ⚠ THE POSITIVE HALF OF THIS PAIR IS GONE. `internalLifecycle`'s one caller
  // was the close echo (`service-tasks-lifecycle.ts › closeTask`), deleted with
  // thread closing (wiring plan Phase 4, 2026-08-18), so there is no server-
  // internal lifecycle post left to drive it through. What survives is the half
  // that matters more: the OPTION is the exemption, a caller's METADATA key of
  // the same name is not.
  it("`internalLifecycle` in a caller's METADATA is not an exemption", async () => {
    await expect(
      postMessage(agentCtx, "general", {
        body: "done",
        kind: "task_finished",
        metadata: { internalLifecycle: true },
      })
    ).rejects.toBeInstanceOf(ChannelLifecycleKindForbiddenError);
  });
});
