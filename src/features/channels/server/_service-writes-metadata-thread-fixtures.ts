/**
 * Shared fixtures for the thread-tag suite — `service-writes-metadata-thread.test.ts`,
 * extracted 2026-10-11 on the 500-line cap (the file reached 567).
 *
 * ⚠ **THE `vi.mock` CALLS STAY IN THE TEST FILE** — they are hoisted per module graph and a
 * shared module cannot declare them. This file only FILLS the mocks in, through
 * {@link installThreadMocks}, which is the same shape
 * `_service-writes-metadata-escalation-fixtures.ts` took when the two escalation suites split
 * on this cap on 2026-09-14. Same directory, same family, same reason.
 *
 * ⚠ NO TEST MOVED to make this fit. The suite still holds all 23 of its cases; what left is
 * the fixture layer, so there is no risk of a case being dropped in transit — which is the
 * failure mode a cap-driven split of a test file actually has.
 */
import { vi } from "vitest";
import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

export const WS = "ws-1";
export const USER = "11111111-e29b-41d4-a716-446655440000";
export const PEER = "22222222-e29b-41d4-a716-446655440000";
export const THIRD = "33333333-e29b-41d4-a716-446655440000";
export const TASK_ID = "44444444-e29b-41d4-a716-446655440000";

/** A legacy `task-{channelId}-{seq}` id — the shape the desktop still posts. */
export const LEGACY_ID = "task-chan-1-7";

export const ctx: ChannelContext = {
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
export const desktopCtx: ChannelContext = { ...ctx, source: "user" };

export function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
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
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

export function memberRow(userId: string, role = "member"): ChannelMemberRow {
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
    joined_at: "2026-07-31T00:00:00Z",
  };
}

export function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
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
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

/** The legacy exchange's opening request at seq 7: PEER asked USER. */
export function opener(overrides: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
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
    created_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

export function insertedRow(
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
    created_at: "2026-07-31T00:00:00Z",
  };
}

/** The metadata object handed to `repoMessages.insertMessage`. */
export function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

export function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

/** Fills the four mocked repositories in. Call it from the suite's own `beforeEach`. */
export function installThreadMocks(): void {
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
  // ⚠ An explicit `to` also asserts ACTIVE workspace membership. Load-bearing
  // for every addressed post now that DM auto-address is retired.
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
  vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(opener());
}
