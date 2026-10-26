/**
 * DM THREAD INHERITANCE — when a post with no `thread` tag joins the pair's one
 * open thread anyway.
 *
 * ⚠ Split out of `service-writes-metadata.test.ts` (wiring plan Phase 3), when
 * the rule it tests changed shape: inheritance used to ride on the DM
 * AUTO-ADDRESS — the server stamped the peer, and the stamp was what matched.
 * With the auto-address retired, the gate is the caller's own EXPLICIT
 * `toUserId`, which makes this an addressing rule rather than a metadata detail
 * and gives it its own reason to change.
 *
 * The harness is a copy of the metadata fold's, deliberately: these drive the
 * real `postMessage`, and a shared fixture module would be one more thing to
 * keep in step with a fold that changes for many other reasons.
 */

/**
 * Post-metadata folds, driven through `postMessage` so the wiring is covered.
 *
 * ⚠ The bug this exists for: an agent reply posted over MCP into a DM carried NO
 * `to_user_id` and NO `threadId`, so the peer's desktop read it as an unaddressed
 * agent message (the deliberate loop brake → ignore) with no thread id to route it
 * to the waiting session. The server stamps both WITHOUT weakening the
 * anti-spoof strip.
 *
 * Who may TAG a thread, and the calm-terminal flags riding on that decision,
 * live in `service-writes-metadata-thread.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-threads");

import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoMessages from "./repository-messages";
import * as repoThreads from "./repository-threads";
import { postMessage } from "./service-writes";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelThreadActivityRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const THREAD_ID = "44444444-e29b-41d4-a716-446655440000";
const OTHER_THREAD_ID = "55555555-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "agent",
  role: "member",
};

/**
 * The ctx a lifecycle post really arrives on. `postMessage` refuses
 * `thread_started` / `thread_finished` / `thread_failed` from an AGENT-TOKEN caller,
 * and the desktop's own echoes are not that lane:
 * `dopl-desktop-app/main/channel-post.postThreadEvent` posts on the Electron
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
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-07-29T00:00:00Z",
  };
}

function threadRow(overrides: Partial<ChannelThreadActivityRow> = {}): ChannelThreadActivityRow {
  return {
    id: THREAD_ID,
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
  // ⚠ THE AUTHOR'S OWN PROJECTION, EMPTY (2026-09-02, F-589). RR2 reads it to
  // check the `client_msg_id` agent stamp — a CALLER-SUPPLIED claim — against
  // the agents this author actually runs, so a file that leaves it unstubbed
  // reaches the real admin client and times out rather than failing.
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
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
  vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [],
      truncated: false,
    });
});

describe("postMessage — DM thread-id inheritance", () => {
  it("inherits the single open thread and fires the reserved-key stamping", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow()],
      truncated: false,
    });

    // ⚠ ADDRESSED EXPLICITLY. With DM auto-address retired, inheritance fires
    // for a post that NAMES the peer — the shape the composer now always sends.
    await postMessage(ctx, "dm", { body: "here is the answer", toUserId: PEER });

    const meta = capturedMetadata();
    expect(meta.threadId).toBe(THREAD_ID);
    // Desktop routing / suppression predicates read exactly these.
    expect(meta.threadMode).toBe("interactive");
    expect(meta.threadCreatedBy).toBe(PEER);
    expect(meta.threadTitle).toBe("Wire the listener");
    expect(meta.threadTarget).toBe(USER);
    expect(meta.to_user_id).toBe(PEER);
    expect(repoThreads.findThreadByChannelAndId).not.toHaveBeenCalled();
  });

  it("inherits a thread the AUTHOR created and addressed to the peer", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [
      threadRow({ created_by: USER, target_user_id: PEER, mode: "autonomous" }),
    ],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "any progress?", toUserId: PEER });

    const meta = capturedMetadata();
    expect(meta.threadId).toBe(THREAD_ID);
    expect(meta.threadMode).toBe("autonomous");
  });

  it("stamps nothing with 2+ open candidates (which thread is ambiguous)", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [
      threadRow(),
      threadRow({ id: OTHER_THREAD_ID, created_by: USER, target_user_id: PEER }),
    ],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "reply", toUserId: PEER });

    expect(has(capturedMetadata(), "threadId")).toBe(false);
  });

  it("inherits NOTHING for a post that addresses nobody", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow()],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "thinking out loud" });

    // ⚠ The gate is the ADDRESSEE now, not the auto-addressed peer: with no
    // `to` there is no peer to match, so the roster is never even read.
    expect(has(capturedMetadata(), "threadId")).toBe(false);
    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("inherits nothing when the DM roster is not exactly two", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "owner"),
      memberRow(PEER),
      memberRow(THIRD),
    ]);
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow()],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "reply", toUserId: PEER });

    // A ghost member makes the pair ambiguous; all-or-nothing, as before.
    expect(has(capturedMetadata(), "threadId")).toBe(false);
    expect(capturedMetadata().to_user_id).toBe(PEER);
  });

  it("ignores threads whose participants are not {author, peer}", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [
      threadRow({ id: OTHER_THREAD_ID, created_by: THIRD, target_user_id: USER }),
      threadRow({ id: OTHER_THREAD_ID, created_by: USER, target_user_id: null }),
    ],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "reply", toUserId: PEER });

    const meta = capturedMetadata();
    expect(has(meta, "threadId")).toBe(false);
    expect(has(meta, "threadMode")).toBe(false);
  });

  // ⚠ THE RULE INVERTED ON 2026-08-18 (wiring plan Phase 4). This used to assert
  // the opposite — `resolveInheritableThread` filtered `status === "open"` and a
  // legacy `closed` row was skipped. Threads no longer close, so the filter's
  // only remaining effect was to make a pair whose one thread was closed BEFORE
  // the removal inherit nothing at all, which reads as inheritance being broken.
  // `channel_threads.status` is legacy and unread (INVARIANTS §5); this is the pin
  // that a new `=== "open"` filter here is a regression, not a tightening.
  it("inherits a LEGACY closed thread — status is not read any more", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow({ status: "closed", outcome: "completed" })],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "reply", toUserId: PEER });

    expect(capturedMetadata().threadId).toBe(THREAD_ID);
  });

  it("a caller-supplied threadId suppresses inheritance (explicit threading wins)", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ id: OTHER_THREAD_ID, title: "Explicit" })
    );

    await postMessage(ctx, "dm", {
      body: "reply",
      metadata: { threadId: OTHER_THREAD_ID },
    });

    expect(capturedMetadata().threadId).toBe(OTHER_THREAD_ID);
    expect(repoThreads.listThreadsByChannel).not.toHaveBeenCalled();
  });

  it("a legacy thread-<uuid>-<seq> id suppresses inheritance and stamps nothing", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow()],
      truncated: false,
    });
    // Poster is the opening request's addressee, so the tag survives its gate;
    // this pins that it still suppresses inheritance and resolves no thread row.
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
      metadata: { threadId: "thread-chan-1-7" },
    });

    const meta = capturedMetadata();
    expect(meta.threadId).toBe("thread-chan-1-7");
    expect(has(meta, "threadMode")).toBe(false);
    expect(repoThreads.listThreadsByChannel).not.toHaveBeenCalled();
  });

  it("never inherits in a NON-direct channel", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ is_direct: false, direct_key: null })
    );

    await postMessage(ctx, "dm", { body: "reply", toUserId: PEER });

    expect(has(capturedMetadata(), "threadId")).toBe(false);
    expect(repoThreads.listThreadsByChannel).not.toHaveBeenCalled();
  });

  it("never inherits onto a lifecycle event (a marker must not land on someone else's thread)", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow()],
      truncated: false,
    });

    await postMessage(desktopCtx, "dm", { body: "done", kind: "thread_finished" });

    expect(has(capturedMetadata(), "threadId")).toBe(false);
    expect(repoThreads.listThreadsByChannel).not.toHaveBeenCalled();
  });

  it("does not inherit when the post is explicitly addressed away from the peer", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow()],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "note to self", toUserId: USER });

    expect(has(capturedMetadata(), "threadId")).toBe(false);
  });
});

/**
 * `runtime` is RESERVED, stamped from the request's own `X-Dopl-Runtime` header
 * (auth layer resolves it into `ctx.runtime`), so the desktop can tell a session
 * it spawned from an external agent's post. ⚠ A caller able to set it in
 * `metadata` could masquerade as a desktop session and steal the reply routing,
 * so the strip holds on BOTH sides of the stamp.
 */
